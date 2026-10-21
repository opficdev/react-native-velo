package com.margelo.nitro.exampleproducer

import android.content.Context
import android.hardware.display.DisplayManager
import android.os.Build
import android.os.PowerManager

// 나쁜 정도 순서의 열 상태 이름 목록
val thermalNames = listOf("nominal", "fair", "serious", "critical")

// 안드로이드 열 상태를 nominal(0)부터 critical(3)까지의 값으로 바꾼 결과
fun thermalLevel(context: Context?): Int {
    val power = context?.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return 0
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
        return 0
    }
    return when (power.currentThermalStatus) {
        PowerManager.THERMAL_STATUS_NONE -> 0
        PowerManager.THERMAL_STATUS_LIGHT, PowerManager.THERMAL_STATUS_MODERATE -> 1
        PowerManager.THERMAL_STATUS_SEVERE -> 2
        else -> 3
    }
}

// 측정 결과 줄에 남기는 기기와 실행 환경 정보
fun benchDeviceInfo(context: Context?): DeviceInfo {
    val power = context?.getSystemService(Context.POWER_SERVICE) as? PowerManager
    val display = (context?.getSystemService(Context.DISPLAY_SERVICE) as? DisplayManager)?.getDisplay(0)
    val refresh = display?.supportedModes?.maxOfOrNull { it.refreshRate } ?: 0f
    val emulator = Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish" || Build.FINGERPRINT.contains("generic")
    val known = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
    return DeviceInfo(
        Build.MODEL,
        Build.VERSION.RELEASE,
        refresh.toDouble(),
        if (known) thermalNames[thermalLevel(context)] else "unknown",
        power?.isPowerSaveMode ?: false,
        emulator,
    )
}
