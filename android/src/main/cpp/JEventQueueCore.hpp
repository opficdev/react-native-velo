#pragma once

#include <NitroModules/JArrayBuffer.hpp>
#include <fbjni/fbjni.h>

#include "EventQueueCore.hpp"
#include "JFunc_void.hpp"
#include "JPullResult.hpp"

namespace margelo::nitro::eventstream {

using namespace facebook;

// C++ 공유 연결부 EventQueueCore와 Kotlin EventQueueCore를 잇는 JNI 클래스
class JEventQueueCore final : public jni::HybridClass<JEventQueueCore> {
 public:
  static constexpr auto kJavaDescriptor = "Lcom/margelo/nitro/eventstream/EventQueueCore;";

  static void registerNatives();

 private:
  friend HybridBase;

  static jni::local_ref<jhybriddata> initHybrid(jni::alias_ref<jhybridobject>);

  void push(jni::alias_ref<JArrayBuffer::javaobject> data);
  jni::local_ref<JPullResult::javaobject> pull(double maxCount);
  void setSignalListener(jni::alias_ref<JFunc_void::javaobject> listener);
  void dispose();

  EventQueueCore core_;
};

}  // namespace margelo::nitro::eventstream
