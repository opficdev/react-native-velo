import { useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createEventStream } from 'react-native-velo';

function App() {
  // 라이브러리 연결과 네이티브 모듈 등록 확인
  // 구독 등록과 해제 확인
  // 측정 화면은 이후 단계에서 추가
  const stream = useMemo(() => createEventStream(), []);

  useEffect(() => stream.subscribe(() => {}), [stream]);

  return (
    <View style={styles.container}>
      <Text>EventStream</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

export default App;
