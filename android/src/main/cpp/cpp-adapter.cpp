#include <jni.h>
#include <fbjni/fbjni.h>
#include "JEventQueueCore.hpp"
#include "EventStreamOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::eventstream::registerAllNatives();
    margelo::nitro::eventstream::JEventQueueCore::registerNatives();
  });
}