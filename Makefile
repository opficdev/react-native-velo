MISE := mise exec --
CONFIGURATION ?= Debug
DESTINATION ?= generic/platform=iOS Simulator
DERIVED_DATA_PATH ?= /tmp/velo-derived-data
ANDROID_ARCHITECTURES ?= arm64-v8a
PACK_DIR ?= /tmp/velo-pack
TGZ ?= $(firstword $(wildcard $(PACK_DIR)/*.tgz))
PACK_REQUIRED := \
	package/lib/commonjs/index.js \
	package/lib/module/index.js \
	package/lib/typescript/src/index.d.ts \
	package/nitrogen/generated/ios/EventStream+autolinking.rb \
	package/nitrogen/generated/android/EventStream+autolinking.gradle \
	package/nitrogen/generated/android/EventStream+autolinking.cmake \
	package/ios/EventQueueCoreSwift.hpp \
	package/ios/HybridEventQueue.swift \
	package/cpp/nitro/EventQueueCore.hpp \
	package/android/build.gradle \
	package/android/fix-prefab.gradle \
	package/android/CMakeLists.txt \
	package/src/specs/event-queue.nitro.ts \
	package/EventStream.podspec \
	package/nitro.json
PACK_FORBIDDEN := '^package/android/(build|\.cxx)/|tsbuildinfo$$|^package/cpp/\.clang-format$$'

TS_FILES := "**/*.{ts,tsx,js,cjs,mjs}"
KOTLIN_FILES := "android/src/**/*.kt" "example/android/app/src/**/*.kt"
PRODUCER_KOTLIN_FILES := "example/producer/android/src/**/*.kt"
CPP_FILES := $(wildcard cpp/core/*.hpp cpp/core/*.cpp cpp/nitro/*.hpp cpp/nitro/*.cpp)

.PHONY: setup hooks codegen codegen-producer pods typecheck lint lint-ts lint-swift lint-kotlin lint-cpp lint-producer-swift lint-producer-kotlin build-ios build-android pack pack-check install-pack

setup: hooks
	$(MISE) npm ci
	cd example && $(MISE) npm ci
	$(MAKE) codegen
	$(MAKE) codegen-producer
	$(MAKE) pods

hooks:
	git config core.hooksPath .githooks

codegen:
	$(MISE) npm run codegen

codegen-producer:
	cd example/producer && $(MISE) npm run codegen

pods:
	cd example && $(MISE) bundle install
	cd example/ios && $(MISE) bundle exec pod install

typecheck:
	$(MISE) npm run typecheck
	cd example && $(MISE) npm run typecheck

lint: lint-ts lint-swift lint-kotlin lint-cpp lint-producer-swift lint-producer-kotlin

lint-ts:
	$(MISE) npx eslint --max-warnings 0 .
	$(MISE) npx prettier --check $(TS_FILES)

lint-swift:
	$(MISE) swiftlint lint --strict --no-cache --config .swiftlint.yml

lint-kotlin:
	$(MISE) ktlint $(KOTLIN_FILES)

lint-cpp:
	$(MISE) clang-format --dry-run --Werror $(CPP_FILES)

lint-producer-swift:
	cd example/producer && $(MISE) swiftlint lint --strict --no-cache --config .swiftlint.yml

lint-producer-kotlin:
	$(MISE) ktlint $(PRODUCER_KOTLIN_FILES)

build-ios:
	cd example/ios && $(MISE) xcodebuild -quiet \
		-workspace VeloExample.xcworkspace \
		-scheme VeloExample \
		-configuration "$(CONFIGURATION)" \
		-destination "$(DESTINATION)" \
		-derivedDataPath "$(DERIVED_DATA_PATH)" \
		CODE_SIGNING_ALLOWED=NO \
		build

build-android:
	cd example/android && $(MISE) ./gradlew assemble$(CONFIGURATION) \
		-PreactNativeArchitectures=$(ANDROID_ARCHITECTURES)

pack:
	rm -rf "$(PACK_DIR)"
	mkdir -p "$(PACK_DIR)"
	$(MISE) npm pack --pack-destination "$(PACK_DIR)"

pack-check:
	@test -n "$(TGZ)" || { echo "TGZ 없음: make pack을 먼저 실행"; exit 1; }
	@list=$$(tar -tzf "$(TGZ)") && \
	for path in $(PACK_REQUIRED); do \
		echo "$$list" | grep -qxF "$$path" || { echo "배포물에 없음: $$path"; exit 1; }; \
	done && \
	if echo "$$list" | grep -E $(PACK_FORBIDDEN); then \
		echo "배포물에 들어가면 안 되는 파일 있음"; exit 1; \
	fi

install-pack:
	@test -n "$(TGZ)" || { echo "TGZ 없음: make pack을 먼저 실행"; exit 1; }
	cd example && $(MISE) npm install --no-save "$(TGZ)"
