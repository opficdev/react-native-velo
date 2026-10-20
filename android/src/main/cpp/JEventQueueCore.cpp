#include "JEventQueueCore.hpp"

#include <NitroModules/JNICallable.hpp>
#include <functional>
#include <utility>

namespace margelo::nitro::velo {

void JEventQueueCore::registerNatives() {
  registerHybrid({
      makeNativeMethod("initHybrid", JEventQueueCore::initHybrid),
      makeNativeMethod("push", JEventQueueCore::push),
      makeNativeMethod("pull", JEventQueueCore::pull),
      makeNativeMethod("setSignalListener", JEventQueueCore::setSignalListener),
      makeNativeMethod("dispose", JEventQueueCore::dispose),
  });
}

jni::local_ref<JEventQueueCore::jhybriddata> JEventQueueCore::initHybrid(jni::alias_ref<jhybridobject>) {
  return makeCxxInstance();
}

void JEventQueueCore::push(jni::alias_ref<JArrayBuffer::javaobject> data) {
  core_.push(data->cthis()->getArrayBuffer());
}

jni::local_ref<JPullResult::javaobject> JEventQueueCore::pull(double maxCount) {
  if (!EventQueueCore::validMaxCount(maxCount)) {
    jni::throwNewJavaException("java/lang/IllegalArgumentException", "maxCount must be an integer greater than or equal to 1");
  }
  return JPullResult::fromCpp(core_.pull(maxCount));
}

void JEventQueueCore::setSignalListener(jni::alias_ref<JFunc_void::javaobject> listener) {
  if (listener == nullptr) {
    core_.clearSignalListener();
    return;
  }
  // JS에서 온 콜백은 원래 std::function으로 바로 사용
  if (listener->isInstanceOf(JFunc_void_cxx::javaClassStatic())) {
    auto downcast = jni::static_ref_cast<JFunc_void_cxx::javaobject>(listener);
    core_.setSignalListener(downcast->cthis()->getFunction());
    return;
  }
  core_.setSignalListener(JNICallable<JFunc_void, void()>(jni::make_global(listener)));
}

void JEventQueueCore::dispose() {
  core_.dispose();
}

}  // namespace margelo::nitro::velo
