package com.margelo.nitro.exampleproducer

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.eventstream.HybridEventQueueSpec
import java.nio.ByteOrder
import java.util.concurrent.Executors
import java.util.concurrent.ScheduledFuture
import java.util.concurrent.TimeUnit

// 받은 스트림에 100ms마다 8바이트 카운터를 넣는 예제 생산자
@DoNotStrip
class HybridExampleProducer : HybridExampleProducerSpec() {
    private val executor = Executors.newSingleThreadScheduledExecutor()
    private var task: ScheduledFuture<*>? = null

    @Synchronized
    override fun start(stream: HybridEventQueueSpec) {
        task?.cancel(false)
        var count = 0L
        task =
            executor.scheduleAtFixedRate(
                {
                    count += 1
                    val buffer = ArrayBuffer.allocate(Long.SIZE_BYTES)
                    buffer.getBuffer(false).order(ByteOrder.LITTLE_ENDIAN).putLong(0, count)
                    stream.push(buffer)
                },
                0,
                100,
                TimeUnit.MILLISECONDS,
            )
    }

    @Synchronized
    override fun stop() {
        task?.cancel(false)
        task = null
    }

    override fun dispose() {
        executor.shutdownNow()
    }
}
