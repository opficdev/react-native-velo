package com.exampleproducer

import com.facebook.react.BaseReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.module.model.ReactModuleInfoProvider

class ExampleProducerPackage : BaseReactPackage() {
    override fun getModule(
        name: String,
        reactContext: ReactApplicationContext,
    ): NativeModule? = null

    override fun getReactModuleInfoProvider() = ReactModuleInfoProvider { emptyMap() }

    companion object {
        init {
            // 네이티브 라이브러리 로드(JNI_OnLoad에서 Nitro 등록)
            System.loadLibrary("ExampleProducer")
        }
    }
}
