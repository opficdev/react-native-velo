import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { createEventStream } from 'react-native-velo';

function App() {
  // 라이브러리 연결과 네이티브 모듈 등록을 확인한다. 측정 화면은 이후 단계에서 추가한다.
  const stream = useMemo(() => createEventStream(), []);

  return (
    <View style={styles.container}>
      <Text>{stream.name}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});

export default App;
