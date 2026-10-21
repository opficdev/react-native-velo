//
//  BenchDevice.swift
//  ExampleProducer
//
//  Created by opfic on 2026/10/21.
//

import Foundation
import UIKit

// 측정 결과 줄에 남기는 기기와 실행 환경 정보
func benchDeviceInfo() -> DeviceInfo {
  var system = utsname()
  uname(&system)
  let machine = withUnsafePointer(to: &system.machine) { pointer in
    pointer.withMemoryRebound(to: CChar.self, capacity: Int(_SYS_NAMELEN)) { String(cString: $0) }
  }
  let environment = ProcessInfo.processInfo.environment
  #if targetEnvironment(simulator)
  let simulator = true
  let model = environment["SIMULATOR_MODEL_IDENTIFIER"] ?? machine
  #else
  let simulator = false
  let model = machine
  #endif
  let names = ["nominal", "fair", "serious", "critical"]
  let thermal = min(ProcessInfo.processInfo.thermalState.rawValue, names.count - 1)
  return DeviceInfo(
    model: model,
    osVersion: UIDevice.current.systemVersion,
    maxRefreshHz: Double(UIScreen.main.maximumFramesPerSecond),
    thermalState: names[thermal],
    lowPowerMode: ProcessInfo.processInfo.isLowPowerModeEnabled,
    isSimulator: simulator
  )
}
