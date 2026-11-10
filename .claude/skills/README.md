# 디자인 스킬 3개

이 저장소에서 Claude Code를 열면 아래 스킬을 자동으로 불러옵니다. 웹 화면을 만들거나 고칠 때 Claude가 알아서 읽고, 이름을 직접 불러 쓸 수도 있어요.

| 스킬 | 하는 일 | 출처 (가져온 커밋) | 라이선스 |
|---|---|---|---|
| `frontend-design` | AI가 자주 쓰는 뻔한 디자인을 피하고, 주제에 맞는 색과 글꼴을 고르게 해요 | [anthropics/skills](https://github.com/anthropics/skills) `skills/frontend-design` (`2c5958e`) | Apache 2.0 |
| `impeccable` | 디자인 지시어(bolder, layout, typeset, critique, audit, polish 등)로 고치고 AI 티를 검사해요 | [pbakaus/impeccable](https://github.com/pbakaus/impeccable) `.claude/skills/impeccable` (`ec229b4`) | Apache 2.0 |
| `design-taste-frontend` | 회사 홈페이지 수준의 규칙(하우스 룰 9개)을 지키게 해요 | [Leonxlnx/taste-skill](https://github.com/Leonxlnx/taste-skill) `skills/taste-skill` (`f6b7657`) | MIT |

`.claude/agents/`의 `impeccable-*.md` 4개는 impeccable 스킬이 일을 나눠 맡기는 보조 에이전트입니다.

내용은 원본 그대로이고, 각 스킬 폴더에 라이선스 파일이 들어 있어요. impeccable의 자동 검사 훅(`.claude/settings.json`)은 넣지 않았습니다. 그 훅은 파일을 고칠 때마다 명령을 실행하고, 처음 실행할 때 엔진을 내려받아요. 쓰려면 원본 저장소의 설정을 직접 확인한 뒤 추가하세요.

## 이렇게 써요

```
[동네 빵집] 홈페이지를 만들어 줘. [아침 7시에 열고, 바게트가 제일 잘 팔려.]
디자인 스킬 세 개를 다 써 줘.
먼저 디자인 방향(분위기, 색, 글꼴, 첫 화면 구성)을 3줄로 보여 주고, 그다음 HTML 파일 하나로 만들어 줘.
```

만든 다음에는 같은 대화에서 짧게 말해 다듬어요.

| 지시어 | 이렇게 말하면 |
|---|---|
| bolder | "더 과감하게 해 줘" |
| layout | "여백 맞춰 줘" |
| typeset | "글자 다듬어 줘" |
| critique | "평가해 줘" |
| audit | "AI 티 검사해 줘" |
| polish | "마무리해 줘" |

스킬을 안 쓰는 것 같으면 `/impeccable audit`이나 "design-taste-frontend 규칙 기준으로 다시 봐 줘"처럼 이름을 직접 불러요.

## 업데이트

원본 저장소에서 같은 경로를 다시 복사하고, 위 표의 커밋을 새 값으로 바꿔요.
