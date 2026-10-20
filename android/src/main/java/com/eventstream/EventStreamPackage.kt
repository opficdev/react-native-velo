package com.eventstream

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

class EventStreamPackage : BaseReactPackage() {
    override fun getModule(
        name: String,
        reactContext: ReactApplicationContext,
    ): NativeModule? = null

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider { emptyMap() }

    companion object {
        init {
            // nitrogen이 만든 EventStreamOnLoad는 internal이라 직접 참조할 수 없다.
            // 하는 일은 네이티브 라이브러리 로드(JNI_OnLoad에서 Nitro 등록)뿐이므로 같은 호출을 쓴다.
            System.loadLibrary("EventStream")
        }
    }
}
