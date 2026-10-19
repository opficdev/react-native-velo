## 🔗 연관된 이슈
<!-- 이슈 번호 입력. 예: #12 -->
<!-- 이슈가 완전히 해결되었다면 아래에 예약어 작성 -->
- closed #이슈번호

## 🎯 의도

## 📝 작업 내용

### 📌 요약

### 🔍 상세

## 🔄 구조와 동작 흐름
<!-- Mermaid로 구조(네이티브 생산자, C++ 공통 코어, Nitro 경계, JS 소비자와 데이터·신호의 방향)를 먼저 그리고 이어서 변경 전후의 동작 흐름 작성 -->
<!-- 구조도는 네이티브, C++ 코어, Nitro, JS를 subgraph로 구분하고 이번 PR에서 추가, 변경, 제거된 요소를 노드 문구에 표시 -->
<!-- 한쪽만 변경하는 PR에서도 구조도에 상대편과의 경계 표시 -->

<!-- 구조 예시: 실제 구현에 맞게 수정 -->
```mermaid
flowchart LR
	subgraph Native["네이티브"]
		producer["생산자"]
	end
	subgraph Core["C++ 코어"]
		queue["제한 큐 (변경)"]
	end
	subgraph Nitro["Nitro"]
		stream["VeloStream"]
	end
	subgraph JS["JS"]
		consumer["소비자"]
	end
	producer -->|"넣기"| queue
	queue -->|"신호"| stream
	stream -->|"신호 전달"| consumer
	consumer -->|"가져가기"| stream
	stream -->|"가져가기 전달"| queue
	queue -->|"멈춤과 재개"| producer
```

<!-- 동작 흐름 예시: 변경 전후의 흐름에 맞게 수정하고 처리 조건 분기와 오류 처리 포함 -->
```mermaid
flowchart TD
	request["요청"] --> condition{"처리 조건 충족"}
	condition -->|예| processing["처리"]
	processing --> result["결과 반환"]
	condition -->|아니요| failure["오류 반환"]
```

## 📸 영상 / 이미지 (Optional)
