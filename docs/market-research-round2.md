# 시장 검증 리서치 2차 — 광고 단가·포털 계약 조건 집중

- 조사일: 2026-08-05
- 목적: 1차 조사에서 전멸한 "수익 수치" 층 재조사
- 결과: **확정 14 / 기각 11** (1차: 확정 10 / 기각 15)
- 규모: 102 에이전트, 1,352 툴콜, 66분

## 1차 대비 무엇을 바꿨나

| 1차 실패 원인 | 2차 대응 | 효과 |
|---|---|---|
| 검색 쿼터를 6개 각도에 분산 | 5개 각도로 좁히고 숫자에만 집중 | 부분적 (여전히 200/200 소진) |
| steamdb·gamalytic 403/429 차단 | 해당 도메인 의존 금지 | 유효 |
| 벤더 PR 만장일치 기각 | **검증 기준을 "권위 있는 출처"에서 "식별 가능한 개발자의 1인칭 자기보고"로 변경** | **결정적** — 이것이 14건 확정의 주 원인 |

추가로 검증자들이 Reddit 직접 fetch 차단을 **Wayback 캡처와 old.reddit raw HTML 파싱으로 우회**했고, CrazyGames 계약서 PDF를 직접 내려받아 **pypdf로 전문 기계 검색**했다.

---

## 0. 한 줄 요약

**계약서에 무엇이 쓰여 있는지는 거의 다 알아냈다. 실제로 얼마를 받는지는 여전히 데이터포인트 2개뿐이다.**

검증 통과한 RPM 관측치는 **전 기간 통틀어 단 1건**이다. 이 한 점으로는 범위도 추세도 말할 수 없다. 다만 그 한 점이 **의사결정을 바꿀 만큼 낮다.**

---

## 1. 가장 중요한 발견 — 첫 지급까지 필요한 플레이 수

### 검증 통과한 유일한 실측 단가

> **CrazyGames: 100,000 플레이 / 55,000 순유저에서 온사이트 광고수익 $40**
> = **1,000 플레이당 약 $0.40**, 순유저 1,000명당 약 $0.73
> — Monster Defense (Studio Javelin, u/piranhaMagi), 2023-01-05 자가보고, 3-0

원문: *"Crazygames.com: $40 from on-site ad revenue on 55K unique players over 100K plays (avg playtime of 11 min). 9.1 rating over 2,736 ratings."*
(Reddit 차단으로 Wayback 캡처 `20230106032839` old.reddit HTML로 원문 대조. 게임 링크·Play 스토어 ID 확인. Google Play에는 광고를 넣지 않았다고 밝혀 이 $40이 CrazyGames 온사이트 배분임이 확정)

**개발자 본인이 밝힌 하향 편향 요인:** *"it's a web portal with dodgy save functionality in our build up there"* — 세이브 버그로 즉시 이탈한 유저가 평균을 끌어내렸을 수 있다.

**시의성 경고:** 2023-01 보고. **3.5년 경과.** 현재 단가나 추이의 근거로 쓸 수 없다.

### 이 숫자가 강제하는 계산

CrazyGames 최소지급은 **월 100 EUR**(미달 시 이월). 이를 플레이 수로 환산하면:

| 가정 RPM | 첫 €100 지급까지 필요한 누적 플레이 |
|---|---|
| $0.40 / 1k plays (**검증됨**, 2023-01) | **약 275,000 플레이** |
| €1.23 / 1k plays (*기각됨*, 참고용 상한 힌트) | 약 81,000 플레이 |

> ### ⚠️ 이것이 이 리서치의 핵심 산출물이다
> **첫 입금을 보려면 대략 8만 ~ 28만 플레이가 필요하다.**
> 이건 "잘 만들면 되는" 수준의 숫자가 아니다. 신작 웹게임 한 편이 포털에서 얻는 트래픽 규모를 생각하면, **1인 첫 게임이 첫 입금에 도달하지 못할 가능성이 상당하다.**

*(€1.23 수치는 DonislawDev의 8개 게임 합산 보고로, 3표 중 1표 차이(1-2)로 기각됐다. 인용 불가지만 자릿수 감각으로는 유효한 참고점이다 — 확정치 $0.40과 3배 이내 차이라는 점이 중요.)*

---

## 2. CrazyGames 계약 구조 (전문 기계 검색으로 확정)

출처: `files.crazygames.com/documents/developer_terms_20250818.pdf` (14페이지, 2025-08-18판)
Publisher = **Maxflow BV** (벨기에 Leuven, 등록번호 0550.758.377), 상호 CrazyGames

### 2-1. 레버뉴셰어 비율은 계약서에 존재하지 않는다 (3-0)

14페이지 전수 기계 검색 결과:

| 검색어 | 등장 횟수 |
|---|---|
| `%` | **1회** (독점 보너스 50%) |
| `revenue` | 0회 |
| `share` | 0회 |
| `split` | 0회 |
| `$` / `USD` | 0회 |
| `EUR` | 2회 (모두 100 EUR 최소지급 문장) |

§5.4 원문:
> *"The amount of the Compensation due to Developer will be calculated by Publisher on a monthly basis on the basis of the following objectively quantifiable criteria: (a) The popularity of the Game(s)... (b) The performance of in-game ads shown and the interest of advertisers in the Game(s)."*

**산식·가중치·비율은 일절 명시되지 않는다.** 온라인에 도는 "CrazyGames는 50/50" 류 수치는 공개 계약서에서 나온 것이 아니다.

### 2-2. Basic Launch에서는 수익이 0이다 (3-0) ⚠️ 신규 발견

§5.3: 보상은 게임이 **Full Launch로 승격된 이후에만** 발생하며, 아래 4개 조건을 **모두** 충족해야 한다:
1. 타 포털 브랜딩 금지
2. CrazyGames SDK 최신 버전 유지
3. SDK 외 광고 금지
4. 충분한 독창성

> *"For the avoidance of doubt, if the Game does not meet all of the conditions mentioned above... no Compensation will be due."*

승격 판단은:
> *"The transition to Full Launch is determined **solely by CrazyGames** based on editorial, quality, and/or performance criteria."*

공식 문서도 일치 (2026-08-05 실시간 확인): Basic Launch는 *"monetization is not available"*, FAQ는 *"During Basic Launch, ads are temporarily disabled"*. §9.1은 승격 실패 시 **게임 삭제로 계약 조기 종료**를 규정.

> **기대수익 모델링 시 `P(Full Launch 도달)`로 반드시 할인해야 한다.** 이 확률에 대한 데이터는 없다.

### 2-3. 선급금 조항이 아예 없다 (3-0)

14페이지 전수 검색 결과 `advance` / `upfront` / `minimum guarantee` / `flat fee`가 **지급 의미로 0회**. §11.1 완전합의조항이 있으므로 **선급금은 별도 서면 사이드딜로만 가능**하다.

*(단 §5.3이 "Unless otherwise agreed in writing"으로 시작하므로 개별 협상 딜은 예외 가능)*

### 2-4. 2개월 독점 = 보상 +50% (3-0) ⭐ 전략적으로 중요

§5.5 원문:
> *"Developer will be entitled to an increase in Compensation of **50%** if the following conditions are met and Developer opts in for the time-based exclusivity: (a) The Game is exclusively available on the Portal Site for **two (2) months** after the Full Launch release date. (b) The Game is hosted by Publisher. ... **Platforms such as Steam, Apple app store and Google play store are not considered browser gaming websites**... Publisher reserves the right to monitor compliance... and will, at its **sole discretion**, decide whether or not these conditions are still met."*

**Poki(기본 5년)와 비교하면 락인 기간이 30분의 1이다.** 이것이 채널 전략을 바꾼다.

**단서:**
- +50%는 **비공개 베이스에 대한 상대 배수** → 금액 환산 불가
- 인상분은 **그 2개월에만** 적용
- §3.3(c)(독점 개발자는 Publisher 외 타 주체에 게임 제공 불가)와 **문언상 긴장**이 있어 Steam 동시출시 가능성은 §5.5 문면상으로만 지지됨
- *"(b) The Game is hosted by Publisher"* = CrazyGames가 빌드를 호스팅 (개발자 자체 호스팅 iframe 임베드가 아님)

### 2-5. 지급 조건 (3-0)

§5.6: 월 100 EUR 미만은 **이월**(소멸 아님). 면제는 CrazyGames 단독 재량.
§5.7: 미청구 잔액은 18개월 통지 후 **24개월 시점 소멸**.
지급은 인보이스 후 30일, 광고주 정산 지연 30–90일.

---

## 3. Poki (3-0, 1차 조사와 일치·보강)

### 3-1. 셰어 구조 재확인

서로 다른 두 페이지가 다른 문구로 동일 구조를 진술 → 오독·스테일 가능성 낮음:
- `deals.html`: *"100% of the game's earnings when you bring the player... 50% of the game's earnings when Poki brings the player"*
- `sdk.poki.com`: *"If a user comes to your game directly, through bookmarks, search, social media or through your own community, you get 100% of the revenue for that user"*

**검증자 주석:** Poki 자사 문서지만 성과 주장(RPM/성공사례)이 아니라 **자기 계약 조건 서술**이고, **Poki에 불리한 조항(자사 트래픽 50% 취득)을 포함**하므로 벤더 홍보물 배제 원칙에 걸리지 않는다.

### 3-2. 금액은 어디에도 없다 (3-0, NULL FINDING)

공식 4개 페이지(`deals.html`, `sdk.poki.com`, `faq.html`, `developers.poki.com`) 전수 확인 결과 **화폐 수치 0건**. 페이지상 모든 숫자는 비금액: 5년 독점 기본기간, 9,000만 플레이어, 100%/50%, 30/60fps, 16:9, 모바일 3년/브라우저 12–18개월 지원, 버그픽스 1개월, 85% 호환성.

FAQ의 지급 문항조차 *"We pay out developers via wire transfer or PayPal"* 뿐.

> **조사 항목 "선급금 실제 금액대"는 Poki 자료로 답할 수 없다.**

---

## 4. GameDistribution — 셰어 불명 + 카운터파티 리스크 신호 (3-0)

대표 스레드(html5gamedevs, 2017-08~2019-06, 22개 포스트)를 **2회 전수 추출**(2회차는 "숫자·%·$·€ 포함 모든 문장 축자 인용"하는 적대적 방식)한 결과:

**숫자 포함 문장은 정확히 5개이며 어느 것도 셰어·단가가 아니다.** 개발자가 실제 계약 조항을 붙여넣은 유일한 케이스조차 `revenue share`라는 말만 있고 **비율이 없다**:
> *"Within 60 days after the end of the Preceding Month, Distributor will pay Owner's revenue share with respect to that month"*

### ⚠️ 부수적으로 확인된 것 — 지급 분쟁 패턴

2018–2019년 **복수 개발자의 심각한 지급 지연·미지급** 보고: kiz10, bestgames, Phaser911, odiusfly, Cron34, Xtails.
가장 심각한 것:
> Xtails (2019-02): *"i uploaded more than 50 games... i have more than 5k in revenue and they never pay me"*

*(플레이 수·기간이 없어 RPM 산출 불가. 분쟁 맥락의 자기보고임을 감안해야 하나, 6명이 독립적으로 같은 문제를 보고한 패턴 자체가 신호다. 다만 7~8년 전 데이터다.)*

---

## 5. 그 외 확정 사항

### 5-1. 포털 정액 매입가 유일 관측치 (low confidence)

> **CoolMathGames: 게임당 대략 $500–700**
> — u/Traditional-Glass-85, 2025-09-13. *"Around 500-700$ range, I sent 2 endless runner and a few puzzle games. They usually don't buy endless runner games. They are more focused on thinking games, puzzle and stuff."*

**단서 4가지:** (a) "게임당"은 명시가 아니라 **추론** — 여러 게임 합산이면 3배 과대평가, (b) 익명 1줄 댓글, 게임명·계약서·스크린샷 없음, (c) 판매 시점 불명이라 "2025년 시세"로 제시 금지, (d) CoolMathGames는 조사 대상 포털 밖.

> **🚗 우리에게 직접적인 함의:** *"They usually don't buy **endless runner** games"* — 아케이드 레이싱은 CoolMathGames의 매입 취향(퍼즐·사고형)과 맞지 않는다.

### 5-2. "Poki 1,000플레이당 $3.33"은 1차 자료가 아니다 (3-0)

온라인에 도는 이 수치는 **개발자 대시보드 보고가 아니라 제3자의 산술 추정**이다. u/Klawgoth(2022-11-18)이 익명 유튜버의 2020년 영상(수익 $49,000 중 파이차트상 Poki 17%, 플레이 250만)을 나눈 값이며, **본인은 Poki에 게임을 올린 적이 없다고 명시**했다: *"I haven't but I have seen a youtuber mention it before.."*

계산: 17% × $49,000 = $8,330 ÷ 2,500,000 × 1000 = $3.33

Wayback CDX로 스레드 전체 6개 댓글을 교차확인해 삭제된 댓글이 없음도 확인. **이 수치를 인용해서는 안 된다.**

### 5-3. CrazyGames 실제 셰어 — 유일한 1인칭 보고 (medium, 2-1 분열)

> codergautam (Swordbattle.io 개발, github.com/codergautam), 2024-11-03:
> *"you only get **40% revenue share at first**, and pressure you to get in an exclusive contract with them for **60% rev share** which I declined."*

**구조적 정합성:** 계약서의 +50% 독점 보너스와 산술이 정확히 맞는다 (40% × 1.5 = 60%).

**그러나 베이스 40%는 어떤 공개 문서에도 없다.** 단서: (a) n=1 자기보고, (b) *"40% at first"*는 **초기/Basic 단계 티어**일 가능성이 있어 "비독점 영구 요율"로 읽는 건 해석적 강화, (c) 계약상 독점은 2개월 옵트인이므로 60%는 무기한 요율이 아님, (d) 2024-11 보고 → 2026-08 기준 21개월 경과, 그 사이 2025-08 약관 개정.

**3표 중 1표가 반대한 이번 라운드 유일한 분열 클레임.**

---

## 6. NULL FINDING — 여전히 못 찾은 것 (추정치로 채우지 않음)

1. **지역별 RPM 격차** (미국/서유럽 vs 브라질/인도네시아)의 개발자 대시보드 근거
2. **리워드 vs 인터스티셜 단가 차이**의 1차 수치
3. **GameDistribution의 셰어 비율**
4. **Poki 비독점 정액 피의 실제 금액**
5. **CrazyGames 선급금 제시액** (계약상 개념 자체가 부재)
6. **2024~2026 광고 단가 추이** 및 쿠키리스 전환의 실제 영향

후보가 없었던 건 아니다. 아래는 **그럴듯했지만 검증에서 탈락**했으므로 **인용 금지**:

| 기각된 수치 | 표결 |
|---|---|
| DonislawDev: CrazyGames €556.92 / 451,327 플레이 = €1.23/1k (8게임 합산) | 1-2 |
| DonislawDev: Fish Eat Fishes €149.36 / 143,000 플레이 = €1.04/1k | 0-3 |
| DonislawDev: Kongregate 평균 41% 셰어, $1.57/1k plays | 0-3 |
| Y8: 게임당 연 $100, 트래픽 대부분 필리핀·베트남 | 0-3 |
| Poki 비독점 정액 피 "as low as $500" (unazona, 2020) | 0-3 |
| Poki 평생 독점 50/50 제안 (unazona, 2020) | 0-3 |
| ACRgames: CrazyGames 독점 보너스 +30% (2018) | 0-3 |

---

## 7. 한계

1. **확정된 것은 "계약서에 무엇이 쓰여 있는가"뿐.** "실제로 얼마 받았는가"는 2건($0.40/1k, $500–700)에 불과하고 둘 다 n=1 일화. **RPM 관측치가 1개점이라 범위조차 제시 불가.**
2. **시의성:** CrazyGames 약관 2025-08-18판 (12개월 경과, 2026년 개정판 존재 여부 미확인 — 파일명 패턴 프로브 결과 후속 버전 전부 404). Monster Defense $40은 3.5년 경과. CoolMathGames $500–700은 시점 불명.
3. **검증 세션들이 공통적으로 WebSearch 쿼터(200/200)를 소진**한 상태로 진행돼, **계약 텍스트를 반박할 개발자 증언을 능동적으로 탐색하지 못했다.** 문서 내용 클레임은 영향 없지만 "실제 셰어 40%"류는 반대 증거 탐색이 안 된 상태.
4. **Reddit 직접 fetch 차단** → Wayback / old.reddit raw HTML로 검증. 원문 대조는 성공했으나 삭제·수정 댓글 가능성을 완전히 배제 못 함.
5. **Poki 근거는 전부 Poki 자신의 문서.** `earnings` 정의(총매출 vs 서빙비 차감 후) 불명이라 **RPM 환산 불가**. 실제 협상 계약은 공개 조건과 다를 수 있음.
6. **단위 혼동 주의:** Poki 100%/50%는 *유저 출처별 배분*, CrazyGames +50%는 *비공개 베이스에 대한 인상률*, CoolMathGames $500–700은 *작품 매입가*. **서로 다른 축이므로 같은 표에 나란히 놓으면 안 된다.**

---

## 8. 이 조사가 PRD에 강제하는 변경

| 새 사실 | PRD 반영 |
|---|---|
| **$0.40/1k plays → 첫 €100까지 8만~28만 플레이** | 성공/실패 판정 기준을 **금액에서 플레이 수로 재정의** |
| **Basic Launch에서 수익 0, 승격은 CrazyGames 단독 재량** | 실패 판정 기준점을 "출시 후"가 아닌 **"Full Launch 승격 후"**로 변경. 승격 실패를 별도 리스크로 등록 |
| **CrazyGames 2개월 독점 = +50%** (Poki는 5년) | 채널 전략 변경 — **CrazyGames 2개월 독점 선택** |
| CrazyGames 선급금 조항 부재 | 선급금 기대 제거 |
| **GameDistribution 지급 분쟁 패턴 6건** | GameDistribution을 **Phase 1에서 제외** |
| CoolMathGames는 엔들리스 러너를 안 삼 | 정액 매입 경로는 우리 장르와 불일치 — 기대 제거 |
