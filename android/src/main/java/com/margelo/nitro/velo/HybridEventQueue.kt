package com.margelo.nitro.velo

import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer

// 네이티브 제한 큐를 통해 이벤트를 JS로 전달하는 스트림
// 큐와 신호 상태는 C++ 공유 연결부가 소유
@DoNotStrip
class HybridEventQueue : HybridEventQueueSpec() {
    private val core = EventQueueCore()

    override fun setSignalListener(listener: (() -> Unit)?) {
        core.setSignalListener(listener?.let { it as? Func_void ?: Func_void { it() } })
    }

    override fun pull(maxCount: Double): PullResult = core.pull(maxCount)

    override fun push(data: ArrayBuffer) = core.push(data)

    override fun dispose() = core.dispose()
}
