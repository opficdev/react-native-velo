package com.margelo.nitro.exampleproducer

import android.os.Process
import com.margelo.nitro.core.ArrayBuffer
import java.nio.ByteOrder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.locks.LockSupport

// 일정한 속도로 버퍼를 만들어 sink에 넘기는 생성기
// 전용 스레드 실행
// 먼 예정 시각은 parkNanos 대기 뒤 마지막 150µs 스핀 대기
class BenchGenerator(
    private val payload: BenchPayload,
    private val perSecond: Int,
    durationMs: Int,
    private var sink: ((ArrayBuffer) -> Unit)?,
) {
    private val durationNs = durationMs * 1_000_000L
    private val done = CountDownLatch(1)

    @Volatile
    private var cancelled = false

    @Volatile
    var isFinished = false
        private set

    // 아래 값의 쓰기 스레드는 생성기 스레드
    // 아래 값의 읽기 시점은 stop 이후
    private val capacity = perSecond * (durationMs / 1000 + 2)
    private val starts = LongArray(capacity)
    private val costs = LongArray(capacity)
    private val lates = BooleanArray(capacity)
    private var emitted = 0

    fun start() {
        Thread {
            Process.setThreadPriority(Process.THREAD_PRIORITY_URGENT_AUDIO)
            run()
        }.start()
    }

    // 생성기 중단과 스레드 종료 대기
    // 종료 뒤 sink 참조 해제
    fun stop() {
        cancelled = true
        done.await()
        sink = null
    }

    // [fromNs, toNs) 구간에 발행한 이벤트의 통계
    fun window(
        fromNs: Long,
        toNs: Long,
    ): WindowStats {
        val windowCosts = ArrayList<Long>()
        var late = 0
        for (index in 0 until emitted) {
            if (fromNs <= starts[index] && starts[index] < toNs) {
                windowCosts.add(costs[index])
                if (lates[index]) {
                    late += 1
                }
            }
        }
        return WindowStats(emitted, late, windowCosts.sorted())
    }

    class WindowStats(
        val emitted: Int,
        val late: Int,
        val sortedCosts: List<Long>,
    )

    private fun run() {
        val interval = 1_000_000_000L / perSecond
        val begin = System.nanoTime()
        var index = 0L
        while (!cancelled && emitted < capacity) {
            val scheduled = begin + index * interval
            if (durationNs <= scheduled - begin) {
                break
            }
            while (true) {
                val remaining = scheduled - System.nanoTime()
                if (remaining <= 0) {
                    break
                }
                if (150_000 < remaining) {
                    LockSupport.parkNanos(remaining - 150_000)
                }
            }
            val tEmit = System.nanoTime()
            val size = payload.size(index)
            val buffer = ArrayBuffer.allocate(size)
            val bytes = buffer.getBuffer(false).order(ByteOrder.LITTLE_ENDIAN)
            bytes.putDouble(0, tEmit.toDouble())
            bytes.putDouble(8, index.toDouble())
            bytes.position(16)
            payload.fill(bytes, index, size)
            sink?.invoke(buffer)
            val after = System.nanoTime()
            starts[emitted] = tEmit
            costs[emitted] = after - tEmit
            lates[emitted] = 1_000_000 <= tEmit - scheduled
            emitted += 1
            index += 1
        }
        isFinished = true
        done.countDown()
    }
}
