import { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { createBenchProducer } from 'example-producer';
import {
  calibrate,
  runConsumerSuite,
  runStability,
} from './bench/consumer-suite';
import type { HostControl } from './bench/consumer-suite';
import { ConsumerHost } from './bench/consumers/host';
import type { Dispatch } from './bench/consumers/types';
import type { CommitProbe } from './bench/probes/commit';
import { InputProbe } from './bench/probes/input';
import { runSuite } from './bench/runner';
import { consumerCases, loads, scenarios } from './bench/scenarios';
import { runSweep } from './bench/sweep';

interface Mounted {
  probe: CommitProbe;
  onReady: (dispatch: Dispatch) => void;
}

function App() {
  const producer = useMemo(() => createBenchProducer(), []);
  const [text, setText] = useState('대기');
  const [running, setRunning] = useState(false);
  const [mounted, setMounted] = useState<Mounted>();
  const input = useMemo(() => new InputProbe(producer), [producer]);
  const host = useMemo<HostControl>(
    () => ({
      mount: (probe) =>
        new Promise((resolve) => setMounted({ probe, onReady: resolve })),
      unmount: () => setMounted(undefined),
    }),
    [],
  );
  const context = useCallback(
    () => ({ producer, host, input, onProgress: setText }),
    [producer, host, input],
  );

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
      <Pressable
        style={styles.button}
        onPress={() => run(() => calibrate(context()))}
      >
        <Text>보정</Text>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={() =>
          run(() =>
            runConsumerSuite(context(), {
              cases: consumerCases,
              loads,
              paths: ['B', 'Q'],
              rounds: 3,
            }),
          )
        }
      >
        <Text>소비자 측정</Text>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={() =>
          run(() =>
            runConsumerSuite(context(), {
              cases: consumerCases.filter(
                (item) =>
                  item.pattern === 'setState' && item.distribution === 'sensor',
              ),
              loads: [0.9, 1.2],
              paths: ['B', 'Q'],
              rounds: 3,
            }),
          )
        }
      >
        <Text>입력 지연</Text>
      </Pressable>
      <Pressable
        style={styles.button}
        onPress={() => run(() => runStability(context(), ['Q', 'B']))}
      >
        <Text>안정성</Text>
      </Pressable>
      <Pressable
        testID="input-target"
        style={styles.target}
        onPressIn={(event) => input.record(event.nativeEvent.timestamp)}
      >
        <Text>입력 대상</Text>
      </Pressable>
      <View style={styles.slot}>
        {mounted ? (
          <ConsumerHost probe={mounted.probe} onReady={mounted.onReady} />
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  button: { padding: 12, margin: 4, borderWidth: 1 },
  slot: { height: 220 },
  target: { padding: 12, margin: 4, borderWidth: 1, borderStyle: 'dashed' },
});

export default App;
