import { useLayoutEffect, useReducer } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { CommitProbe } from '../probes/commit';
import type { Action, Dispatch } from './types';

const initial: Action = { version: 0, count: 0, last: 0, sum: 0, rows: [] };

const reduce = (_: Action, action: Action) => action;

interface Props {
  probe: CommitProbe;
  onReady: (dispatch: Dispatch) => void;
}

// 상태 소비자의 상태와 화면을 가진 컴포넌트
// 렌더 시작과 커밋 시각을 프로브에 알림
export function ConsumerHost({ probe, onReady }: Props) {
  probe.onRender();
  const [state, dispatch] = useReducer(reduce, initial);
  useLayoutEffect(() => {
    probe.onCommit(state.version);
  }, [probe, state]);
  useLayoutEffect(() => {
    onReady((action) => {
      action.version = probe.onDispatch();
      dispatch(action);
    });
  }, [probe, onReady]);
  return (
    <View style={styles.box}>
      <Text>{`${state.count} ${state.last} ${state.sum}`}</Text>
      {state.rows.map((row) => (
        <Text key={row.seq}>{row.text}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { height: 220, overflow: 'hidden' },
});
