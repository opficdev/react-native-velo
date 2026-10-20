package com.margelo.nitro.eventstream

import com.facebook.jni.HybridData
import com.facebook.proguard.annotations.DoNotStrip
import com.margelo.nitro.core.ArrayBuffer

// C++ 공유 연결부 EventQueueCore를 부르는 JNI 래퍼
@DoNotStrip
class EventQueueCore {
    @DoNotStrip
    private val mHybridData = initHybrid()

    external fun push(data: ArrayBuffer)

    external fun pull(maxCount: Double): PullResult

    external fun setSignalListener(listener: Func_void?)

    external fun dispose()

    private external fun initHybrid(): HybridData
}
