MISE := mise exec --
CONFIGURATION ?= Debug
DESTINATION ?= generic/platform=iOS Simulator
DERIVED_DATA_PATH ?= /tmp/velo-derived-data
ANDROID_ARCHITECTURES ?= arm64-v8a

TS_FILES := "**/*.{ts,tsx,js,cjs,mjs}"
KOTLIN_FILES := "android/src/**/*.kt" "example/android/app/src/**/*.kt"
PRODUCER_KOTLIN_FILES := "example/producer/android/src/**/*.kt"
CPP_FILES := $(wildcard cpp/core/*.hpp cpp/core/*.cpp cpp/nitro/*.hpp cpp/nitro/*.cpp)

.PHONY: setup hooks codegen codegen-producer pods typecheck lint lint-ts lint-swift lint-kotlin lint-cpp lint-producer-swift lint-producer-kotlin build-ios build-android

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
