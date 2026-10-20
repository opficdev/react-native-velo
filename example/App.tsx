import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createBenchProducer } from 'example-producer';
import { runSuite } from './bench/runner';
import { scenarios } from './bench/scenarios';
import { runSweep } from './bench/sweep';

function App() {
  const producer = useMemo(() => createBenchProducer(), []);
  const [text, setText] = useState('대기');
  const [running, setRunning] = useState(false);

  const run = async (task: () => Promise<void>) => {
    if (running) {
      return;
    }
    setRunning(true);
    try {
      await task();
    } catch (error) {
      setText(`실패 ${String(error)}`);
    }
    setRunning(false);
  };

  return (
    <View style={styles.container}>
      <Text>EventStream 측정</Text>
      <Text testID="progress">{text}</Text>
      <Pressable
        style={styles.button}
        onPress={() => run(() => runSuite(producer, setText))}
      >
        <Text>전체 측정</Text>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={() => run(() => runSweep(producer, setText))}
      >
        <Text>pull 비용</Text>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={() =>
          run(() =>
            runSuite(producer, setText, {
              path: 'Q',
              scenario: scenarios[0],
            }),
          )
        }
      >
        <Text>큐 경로 1회</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  button: { padding: 16, margin: 8, borderWidth: 1 },
});

export default App;
