require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "EventStream"
  s.version      = package["version"]
  s.summary      = package["description"]
  s.homepage     = package["homepage"]
  s.license      = package["license"]
  s.authors      = package["author"]

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://github.com/opficdev/react-native-velo.git", :tag => "#{s.version}" }

  s.source_files = [
    # Implementation (Swift)
    "ios/**/*.{swift}",
    # Autolinking/Registration (Objective-C++)
    "ios/**/*.{m,mm}",
    # Swift에서 부르는 C++ 헤더
    "ios/**/*.hpp",
    # Implementation (C++ objects)
    "cpp/**/*.{hpp,cpp}",
  ]

  # Swift 모듈에 공개하는 C++ 헤더
  s.public_header_files = [
    "cpp/nitro/EventQueueCore.hpp",
    "ios/EventQueueCoreSwift.hpp",
  ]

  load 'nitrogen/generated/ios/EventStream+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  install_modules_dependencies(s)
end
