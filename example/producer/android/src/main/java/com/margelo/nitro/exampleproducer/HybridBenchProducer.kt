package com.margelo.nitro.exampleproducer

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.NitroModules
import com.margelo.nitro.core.ArrayBuffer
import com.margelo.nitro.eventstream.HybridEventQueueSpec
import java.io.File
import java.nio.ByteOrder

// 일정한 속도로 이벤트를 만들어 큐 경로나 콜백 경로로 보내는 측정용 생산자
@DoNotStrip
class HybridBenchProducer : HybridBenchProducerSpec() {
    private var size = 1024
    private var payload = BenchPayload.fixed(1024)
    private val frames = FrameMonitor { thermalLevel(NitroModules.applicationContext) }
    private var perSecond = 1000
    private var durationMs = 10_000
    private var generator: BenchGenerator? = null

    @Synchronized
    override fun configure(
        size: Double,
        perSecond: Double,
        durationMs: Double,
    ) {
        this.size = size.toInt()
        this.payload = BenchPayload.fixed(this.size)
        this.perSecond = perSecond.toInt()
        this.durationMs = durationMs.toInt()
    }

    @Synchronized
    override fun configurePayload(
        sizes: ArrayBuffer,
        json: Boolean,
    ) {
        val bytes = sizes.getBuffer(false).order(ByteOrder.LITTLE_ENDIAN)
        val view = bytes.asIntBuffer()
        val table = IntArray(view.remaining())
        view.get(table)
        require(table.isNotEmpty()) { "sizes must not be empty" }
        require(table.all { it in 18..16 * 1024 * 1024 }) { "each size must be between 18 and 16777216" }
        payload = if (json) BenchPayload.json(table, size) else BenchPayload.filled(table, size)
    }

    @Synchronized
    override fun start(stream: HybridEventQueueSpec) {
        generator?.stop()
        val next = BenchGenerator(payload, perSecond, durationMs) { buffer -> stream.push(buffer) }
        generator = next
        next.start()
    }

    @Synchronized
    override fun stop() {
        generator?.stop()
    }

    @Synchronized
    override fun startCallback(onEvent: (data: ArrayBuffer) -> Unit) {
        generator?.stop()
        val next = BenchGenerator(payload, perSecond, durationMs, onEvent)
        generator = next
        next.start()
    }

    @Synchronized
    override fun stopCallback() {
        generator?.stop()
    }

    @Synchronized
    override fun finished(): Boolean = generator?.isFinished ?: true

    @Synchronized
    override fun readStats(
        fromNs: Double,
        toNs: Double,
    ): BenchStats {
        val window = generator?.window(fromNs.toLong(), toNs.toLong()) ?: return BenchStats(0.0, 0.0, 0.0, 0.0, 0.0, 0.0)
        val costs = window.sortedCosts
        val last = costs.size - 1
        return BenchStats(
            window.emitted.toDouble(),
            costs.size.toDouble(),
            window.late.toDouble(),
            if (costs.isEmpty()) 0.0 else costs[last / 2].toDouble(),
            if (costs.isEmpty()) 0.0 else costs[(last * 0.99).toInt()].toDouble(),
            if (costs.isEmpty()) 0.0 else costs[last].toDouble(),
        )
    }

    override fun burst(
        stream: HybridEventQueueSpec,
        size: Double,
        count: Double,
    ) {
        val filler = ByteArray(size.toInt()) { 0x5A }
        for (index in 0 until count.toInt()) {
            val buffer = ArrayBuffer.allocate(size.toInt())
            val bytes = buffer.getBuffer(false).order(ByteOrder.LITTLE_ENDIAN)
            bytes.putDouble(0, System.nanoTime().toDouble())
            bytes.putDouble(8, index.toDouble())
            bytes.position(16)
            bytes.put(filler, 16, size.toInt() - 16)
            stream.push(buffer)
        }
    }

    override fun pushCost(
        stream: HybridEventQueueSpec,
        size: Double,
        count: Double,
    ): Double {
        val filler = ByteArray(size.toInt()) { 0x5A }
        val buffers =
            List(count.toInt()) { index ->
                val buffer = ArrayBuffer.allocate(size.toInt())
                val bytes = buffer.getBuffer(false).order(ByteOrder.LITTLE_ENDIAN)
                bytes.putDouble(0, System.nanoTime().toDouble())
                bytes.putDouble(8, index.toDouble())
                bytes.position(16)
                bytes.put(filler, 16, size.toInt() - 16)
                buffer
            }
        val costs = LongArray(buffers.size)
        for (index in buffers.indices) {
            val begin = System.nanoTime()
            stream.push(buffers[index])
            costs[index] = System.nanoTime() - begin
        }
        costs.sort()
        return costs[costs.size / 2].toDouble()
    }

    override fun nowNs(): Double = System.nanoTime().toDouble()

    // /proc/self/statm의 둘째 값(페이지 수)에 페이지 크기를 곱한 RSS
    override fun memoryBytes(): Double {
        val pages = File("/proc/self/statm").readText().split(" ")[1].toLong()
        return (pages * 4096L).toDouble()
    }

    override fun startFrames() {
        frames.start()
    }

    override fun stopFrames() {
        frames.stop()
    }

    override fun readFrames(): FrameRecord {
        val record = frames.read()
        val buffer = ArrayBuffer.allocate(record.times.size * 8)
        val view = buffer.getBuffer(false).order(ByteOrder.LITTLE_ENDIAN).asDoubleBuffer()
        view.put(record.times)
        return FrameRecord(buffer, thermalNames[record.thermalWorst], record.overflow, record.firstSkewMs)
    }

    override fun deviceInfo(): DeviceInfo = benchDeviceInfo(NitroModules.applicationContext)

    override fun appendResult(line: String) {
        val context = NitroModules.applicationContext ?: return
        // Release 앱의 내부 폴더는 adb로 읽을 수 없어 외부 파일 폴더 사용
        val directory = context.getExternalFilesDir(null) ?: context.filesDir
        File(directory, "bench-results.jsonl").appendText(line + "\n")
    }

    override fun dispose() {
        frames.stop()
        generator?.stop()
    }
}
