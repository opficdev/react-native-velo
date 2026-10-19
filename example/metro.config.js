const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');
const library = require('../package.json');
const peers = Object.keys(library.peerDependencies);

const escape = (value) => value.replace(/[/\\^$*+?.()|[\]{}]/g, '\\$&');

/**
 * 라이브러리 소스는 저장소 루트에 있다. 루트에도 개발용으로 react, react-native 등이 설치되므로
 * 피어 의존성은 루트 사본을 막고 예제 앱의 node_modules에서만 찾게 해 두 벌이 묶이지 않게 한다.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [root],
  resolver: {
    blockList: peers.map(
      (name) =>
        new RegExp(`^${escape(path.join(root, 'node_modules', name))}\\/.*$`),
    ),
    extraNodeModules: Object.fromEntries(
      peers.map((name) => [name, path.join(__dirname, 'node_modules', name)]),
    ),
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
