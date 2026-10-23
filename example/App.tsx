import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AppState,
  Platform,
  Pressable,
  Settings,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
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
import {
  caseId,
  consumerCases,
  loads,
  realisticCases,
  realisticOverloadCases,
  scenarios,
} from './bench/scenarios';
import type { ConsumerCase } from './bench/scenarios';
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

  const runRealistic = (cases: ConsumerCase[]) =>
    run(() =>
      runConsumerSuite(context(), {
        cases,
        loads: [1],
        paths: ['B', 'Q'],
        rounds: 3,
      }),
    );

  // iOS 실행 인자 -veloAutorun으로 현실 빈도 측정을 바로 시작
  // realistic은 JS 여유 조합, overload는 JS 오버로드 조합
  useEffect(() => {
    if (Platform.OS !== 'ios') {
      return;
    }
    const autorun = Settings.get('veloAutorun');
    const all =
      autorun === 'realistic'
        ? realisticCases
        : autorun === 'overload'
          ? realisticOverloadCases
          : undefined;
    if (all === undefined) {
      return;
    }
    // 실행 인자 -veloCases로 쉼표로 구분한 조합 이름만 남기는 필터
    const only = Settings.get('veloCases');
    const cases =
      typeof only === 'string' && only !== ''
        ? all.filter((item) => only.split(',').includes(caseId(item)))
        : all;
    // 실행 직후 active 전환 전에 시작하면 앱 상태 프로브가 처음부터 취소로 표시되는 문제
    // active가 된 뒤의 시작
    if (AppState.currentState === 'active') {
      runRealistic(cases);
      return;
    }
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') {
        subscription.remove();
        runRealistic(cases);
      }
    });
    return () => subscription.remove();
    // 마운트 때 한 번만 실행
  }, []);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
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
                  cases: consumerCases,
                  loads: [0.9],
                  paths: ['Q'],
                  rounds: 3,
                }),
              )
            }
          >
            <Text>소비자 측정 줄임</Text>
          </Pressable>
          <Pressable
            style={styles.button}
            onPress={() =>
              run(() =>
                runConsumerSuite(context(), {
                  cases: consumerCases.filter(
                    (item) =>
                      item.pattern === 'setState' &&
                      item.distribution === 'sensor',
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
            testID="realistic"
            style={styles.button}
            onPress={() => runRealistic(realisticCases)}
          >
            <Text>현실 측정</Text>
          </Pressable>
          <Pressable
            testID="realistic-overload"
            style={styles.button}
            onPress={() => runRealistic(realisticOverloadCases)}
          >
            <Text>현실 과부하 측정</Text>
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
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  // 상태 표시줄과 홈 표시기를 피하는 안전 영역
  safe: { flex: 1 },
  container: { flex: 1, alignItems: 'center', paddingTop: 8 },
  button: { padding: 12, margin: 4, borderWidth: 1 },
  slot: { height: 220 },
  target: { padding: 12, margin: 4, borderWidth: 1, borderStyle: 'dashed' },
});

export default App;
