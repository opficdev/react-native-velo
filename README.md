# react-native-velo

## 설치

- [Releases](https://github.com/opficdev/react-native-velo/releases)에서 설치할 버전을 골라 `<버전>`에 입력

```bash
npm install https://github.com/opficdev/react-native-velo/releases/download/<버전>/react-native-velo-<버전>.tgz react-native-nitro-modules@^0.37.1
```

- `react-native-nitro-modules`는 peer dependency라 함께 설치
- `peerDependencies` 범위
	- `react`: `*`
	- `react-native`: `^0.88.0`
	- `react-native-nitro-modules`: `^0.37.1`
- 한계
	- npm 레지스트리에 올라가 있지 않아 `npm install react-native-velo`로 설치 불가
	- `^0.1.0` 같은 버전 범위로 자동 업데이트 불가, 버전마다 URL 변경
