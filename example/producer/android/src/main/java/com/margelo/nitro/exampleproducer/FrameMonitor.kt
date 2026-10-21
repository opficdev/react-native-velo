package com.margelo.nitro.exampleproducer

import android.os.Handler
import android.os.Looper
import android.view.Choreographer

// 메인 스레드의 화면 갱신 시각을 기록하는 모니터
class FrameMonitor(
    private val thermal: () -> Int,
) {
    class Record(
        val times: DoubleArray,
        val thermalWorst: Int,
        val overflow: Boolean,
        val firstSkewMs: Double,
    )

    private val handler = Handler(Looper.getMainLooper())

    // 아래 값은 lock 안에서만 접근
    private val lock = Any()
    private val times = DoubleArray(CAPACITY)
    private var count = 0
    private var worst = 0
    private var overflow = false
    private var firstSkewMs = 0.0
    private var generation = 0
    private var lastThermalAt = 0L

    // 아래 값은 메인 스레드에서만 접근
    private var callback: Choreographer.FrameCallback? = null

    // 이전 기록 폐기와 메인 스레드 프레임 콜백 등록
    fun start() {
        val current =
            synchronized(lock) {
                generation += 1
                count = 0
                worst = 0
                overflow = false
                firstSkewMs = 0.0
                lastThermalAt = 0L
                generation
            }
        // 메인 스레드가 JS 스레드를 기다릴 수 있어 동기 대기 없이 비동기 등록
        handler.post {
            callback?.let { Choreographer.getInstance().removeFrameCallback(it) }
            callback = null
            if (synchronized(lock) { generation != current }) {
                return@post
            }
            val next =
                object : Choreographer.FrameCallback {
                    override fun doFrame(frameTimeNanos: Long) {
                        record(frameTimeNanos)
                        if (callback === this) {
                            Choreographer.getInstance().postFrameCallback(this)
                        }
                    }
                }
            callback = next
            Choreographer.getInstance().postFrameCallback(next)
        }
    }

    fun stop() {
        synchronized(lock) { generation += 1 }
        handler.post {
            callback?.let { Choreographer.getInstance().removeFrameCallback(it) }
            callback = null
        }
    }

    fun read(): Record =
        synchronized(lock) {
            Record(times.copyOf(count), worst, overflow, firstSkewMs)
        }

    private fun record(frameTimeNanos: Long) {
        // 열 상태 조회는 바인더 호출이라 1초에 한 번만 수행
        val readThermal = synchronized(lock) { 1_000_000_000L <= frameTimeNanos - lastThermalAt }
        val state = if (readThermal) thermal() else 0
        synchronized(lock) {
            if (count == 0) {
                firstSkewMs = (System.nanoTime() - frameTimeNanos) / 1e6
            }
            if (count < CAPACITY) {
                times[count] = frameTimeNanos.toDouble()
                count += 1
            } else {
                overflow = true
            }
            if (readThermal) {
                lastThermalAt = frameTimeNanos
                worst = maxOf(worst, state)
            }
        }
    }

    companion object {
        // 120Hz 기준 1시간 분량
        private const val CAPACITY = 120 * 3600
    }
}
