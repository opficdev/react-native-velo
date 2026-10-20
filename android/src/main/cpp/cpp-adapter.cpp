#include <jni.h>
#include <fbjni/fbjni.h>
#include "JEventQueueCore.hpp"
#include "VeloOnLoad.hpp"

JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void*) {
  return facebook::jni::initialize(vm, []() {
    margelo::nitro::velo::registerAllNatives();
    margelo::nitro::velo::JEventQueueCore::registerNatives();
  });
}