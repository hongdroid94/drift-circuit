# 시장 검증 리서치 — 웹 3D 아케이드 레이싱 수익화

- 조사일: 2026-08-05
- 방법: 6개 검색 각도 → 20개 소스 페치 → 91개 주장 추출 → 상위 25개를 3표 적대적 검증(2표 이상 반박 시 기각)
- 결과: **확정 10 / 기각 15 / 미검증 0**
- 규모: 103 에이전트, 979 툴콜, 45분

---

## 0. 한 줄 요약

**확립된 것은 "진입 비용과 계약 제약"이고, "기대 수익"은 하나도 확립되지 않았다.**
따라서 이 프로젝트는 *수익이 검증된 시장에 진입하는 것*이 아니라, **진입 비용이 매우 낮다는 점을 이용해 수익성을 직접 측정하는 실험**으로 설계해야 한다.

---

## 1. 검증 통과 (High Confidence)

### 1-1. Poki 레버뉴셰어는 고정 비율이 아니다 — 트래픽 출처 기반

> "100% of the game's earnings when you bring the player ... 50% of the game's earnings when Poki brings the player"
> — sdk.poki.com/deals (2026-08-05 라이브 확인), 3-0 만장일치

비독점(Non-Exclusive) 딜은 레버뉴셰어·마케팅 지원 없이 **1회성 정액 라이선스 피**만 지급.

**한계 (반드시 인지):**
- `earnings`의 정의(총 광고매출 / 서빙비 차감 후 순매출)가 문서에 없음 → **실효 수취율 역산 불가**
- "누가 플레이어를 데려왔는지" 판정하는 어트리뷰션 로직은 **비공개이며 개발자가 감사할 수 없음**
- 정액 라이선스 피 금액대·최소지급액·지급시점은 **공개 문서 어디에도 없음**. 공개 T&C는 "Poki does not pay you or owe you any amounts"(테스트 배포 기준)라 명시하고 실제 상업 조건을 NDA 계약으로 넘김
  → **선급금 규모는 공개 소스로 산정 불가.** "미공개/협상 사항"으로 읽어야 하며 "최소치 없음"으로 읽으면 안 됨

**전략적 함의:** 100% 구간이 존재한다는 건 **자체 트래픽 확보가 직접 수익률로 전환**된다는 뜻이다. SEO·숏폼·커뮤니티 유입이 단순 마케팅이 아니라 마진 항목이다.

### 1-2. Poki 독점의 실제 범위 — 5년, 오픈 웹 한정

> "By default, exclusive deals with Poki are set for 5 years"
> "Platforms such as Steam and the mobile app stores as well as traditional consoles are not part of this exclusivity clause."
> — sdk.poki.com/deals, 3-0

**단서 3가지:**
1. 5년은 표준 딜 기본값. Bonus Level 티어는 **오픈웹 7년** → 기간은 티어·협상 의존
2. Poki는 **Discord·YouTube Playables를 "웹 플랫폼"으로 간주** → 모바일 웹/PWA 배포는 독점에 저촉. 채널 (c) 중 **네이티브 앱 랩핑만 안전**
3. 공개 문서는 요약. 실제 체결 계약이 우선

**전략적 함의:** 웹 포털은 `Poki 독점` vs `CrazyGames/GameDistribution 멀티 배포` **택일 구조**다. 5년 락인을 데이터 없이 받는 것은 비대칭 리스크.

### 1-3. Poki 기술 수용 기준 (계약 조건으로 명문화)

> "must be fully responsive and support 16:9 aspect ratio across devices and should run at a minimum of 30 frames per second (\"FPS\"), with a target of 60 FPS, on the Supported Devices and Browsers under standard network conditions (e.g. 3G mobile data or better)"
> Supported Devices = "Mid-range mobile phones released within the last three (3) years"
> — sdk.poki.com/deals, 3-0

**정밀도 보정:** FPS 문장 자체는 `should`지만, 같은 페이지의 별도 조항이 구속력을 부여한다 —
> "The Game(s) must meet the Minimum Game Performance Requirements and function without critical issues ... for at least **85% of the users on each Platform**"

즉 절대 기준이 아니라 **"유저 85% 커버리지"라는 확률적 기준**. 16:9는 별도 요구사항 페이지에서 독립 확인(640×360 / 836×470 / 1031×580), 모바일은 세로/가로 풀스크린 커버도 허용되므로 **"기준 설계 캔버스"에 가깝다**.

**주의:** 30/60FPS 수치는 **라이선싱 딜 페이지에만** 있고 일반 제출 요구사항 페이지에는 FPS 수치가 없다.

### 1-4. 현금흐름 이중 장벽 — 문턱 + 지연

| 포털 | 최소지급 | 지급 조건 |
|---|---|---|
| CrazyGames | €100 (미만 시 이월) | 계약상 NET 60, 실무상 익월 10일경 목표 |
| GameDistribution | EUR 100 (미만 시 이월) | 월간 리포트 생성 후 **60일 이내** |
| Poki | **미공개** | 미공개 (FAQ에 지급 "수단"만 명시) |

> "Regardless of payment method selected, CrazyGames requires a minimum of €100 in earnings before issuing a payout"
> — docs.crazygames.com/payouts (3-0)

CrazyGames 문서 자체 예시가 지연을 정량화: **1월 €30 + 2월 €70 → 3월 중순 합산 지급(약 2.5개월 랙)**.
별도로 €10 인보이스 생성 문턱 존재(지급 문턱 €100과 구분).

**흔한 혼동 지점:** GameDistribution의 €50(PayPal)/€100(계좌이체)은 **퍼블리셔(게임 임베드 사이트 운영자) 측 조건**이지 개발자 조건이 아니다.

**검증자 주석:** €100 문턱보다 **60일 지급 지연이 실제로 더 큰 제약**이므로 두 수치를 함께 봐야 한다.

### 1-5. 아트 에셋 비용은 실질 $0

Kenney Racing Kit — 라이선스 필드 = **Creative Commons CC0**, Version 1.0, **110 files (3D)**, 다운로드 게이트에 "Continue without donating" 존재. (kenney.nl/assets/racing-kit, 3-0)

CC0 원문상 "copy, modify, distribute and perform the work, **even for commercial purposes**, all without asking permission" + 저작자 표시 불요 → **포털 라이선싱·광고 수익화·Steam 이식 모두 채널 제약 없이 허용**(CC0에 field-of-use 제한 없음). CC0는 **철회 불가**라 정책 변경 리스크도 낮다.

**축소 단서 2가지:**
1. CC0는 특허·상표권을 licensing하지 않으며 **저작자 보증(warranty)도 없음** → 포털 계약이 제3자 권리 비침해 보증을 요구하면 그 리스크는 개발자가 진다
2. Racing Kit 페이지 자체는 **스카이박스·UI·폰트·오디오 미포함** → "아트비 전체 $0"는 Kenney의 다른 CC0 팩 + Poly Haven·Quaternius를 합쳐야 성립하는 **추론**

**사업적 리스크:** Kenney 킷은 취미 개발자 재사용 1순위 에셋이라, **전량 Kenney 빌드는 큐레이션 통과 확률에 불리하게 작용할 수 있다.**

### 1-6. Slow Roads — 유일한 웹3D→Steam 확인 사례, 단 수익 근거 아님

> Topograph Interactive / "This is a solo-developed project" / "Slow Roads has been a labour of love since the project began in **2021**" / "Since initial release in **2022**, the web version has never featured ads, microtransactions, or paywalls" / "Planned Release Date: **August 2026**" + "This game is not yet available on Steam"
> — store.steampowered.com/app/3431300 (3-0, 사실관계)

**결정적으로 중요한 점:**
- 2026-08-05 현재 **미출시(위시리스트 전용)** → 판매량·매출·리뷰 데이터 **0**
- 이 게임은 웹에서 **광고를 전혀 쓰지 않음** → 포털 광고 RPM 모델의 사례가 **아니라 그 반대 모델**
- Steam의 "planned release date"는 **상시 밀리는 필드**
- **실측 개발 기간 5년(2021~2026)**

> **이 사례를 3개월 MVP 계획의 근거로 사용하면 안 된다.** 경로의 존재와 타임라인 증거일 뿐, 수익성 증거가 아니다.

---

## 2. 검증 실패 — "수익 수치" 층 전멸

아래는 **전부 기각(0-3 또는 1-2)** 되었다.

| 기각된 주장 | 표결 | 출처 유형 |
|---|---|---|
| Poki 상위 개발자 연 $50,000~$1,000,000 | 0-3 | 벤더 PR (Dealroom 재배포, 원 URL 403) |
| Poki 월 10억 플레이 / 1억 MAU | 0-3 | 동일 |
| Poki 카탈로그 약 1,000개 큐레이션 | 0-3 | 동일 |
| Smash Karts 누적 3,000만 플레이어 | 0-3 | Google 광고주 성공사례 페이지 |
| Tall Team 광고 비중 70~80% | 0-3 | 동일 |
| Tall Team이 AdSense/AdMob 직접 운영 | 0-3 | 동일 |
| CrazyGames 광고 셰어 개발자 60/40 | 0-3 | 비공식 3자 사이트 |
| CrazyGames IAP 리쿱 후 70/30 | 0-3 | 동일 |
| CrazyGames 선급금+레브셰어 혼합 구조 | 0-3 | 동일 |
| GameDistribution 개발자 33% of Net Revenue | 1-2 | 1차 약관(적용 범위 불명확) |
| GameDistribution 라이선스가 비독점 → 멀티배포 가능 | 0-3 | 1차 약관(추론 비약) |
| Slow Roads 1인 개발 (web.dev 인용분) | 0-3 | ※ Steam 페이지로 **소스 교체 후 생존** |
| Slow Roads 플레이어 52%만 55FPS 초과 | 0-3 | web.dev 케이스스터디 |
| Slow Roads 웹=무료퍼널 / Steam=수익원 구조 | 0-3 | 인용 범위 초과 추론 판정 |
| Steam판이 얇은 Electron 랩이 아니라는 주장 | 0-3 | 동일 |

### 기각 패턴이 말해주는 것

1. **벤더 PR·마케팅 케이스스터디는 전멸했다.** Poki 보도자료, Google 광고주 성공사례 → 만장일치 기각
2. **CrazyGames의 실제 셰어율과 선급금 구조는 확인되지 않았다.** 확인된 건 €100 문턱과 NET 60뿐
3. **GameDistribution 쪽 핵심 경제 조건도 미해결.** 같은 문서에서 €100/60일은 3-0으로 통과했으므로 문서 신뢰성 문제가 아니라, 33% 수치의 적용 범위와 비독점 추론의 비약이 문제

> ⚠️ **"기각 = 틀렸다"가 아니다.** 여러 검증 세션에서 WebSearch 쿼터(200/200)가 소진됐고 steamdb.info·gamalytic.com은 403/429로 차단됐다. **"이번 라운드에서 1차 검증에 도달하지 못했다"**로 읽어야 한다.

---

## 3. 조사되지 않은 영역

검증 통과 주장이 **하나도 없는** 항목 — 이 리포트는 아래에 답하지 않는다:

- 한국 시장 특수성
- 쿠키리스 전환 및 2024~2026 광고단가 추이
- TikTok / YouTube 숏폼 / Reddit 유입 경로의 실효성
- 차량 물리(Rapier / cannon-es) 구현 난이도와 소요 시간
- Drive Mad / PolyTrack / Madalin Stunt Cars / Smash Karts의 실측치
- 브라우저 캐주얼 레이싱의 검색 수요·MAU

---

## 4. 방법론적 한계

1. **출처 편중** — 생존 주장 10개 중 9개가 "벤더 자기 문서"(sdk.poki.com, docs.crazygames.com, GD 약관, Steam 스토어, kenney.nl). 계약 조건에는 올바른 1차 출처지만, **수익성·시장규모 질문에는 구조적으로 답할 수 없는 출처 계층**
2. **반증 실패 ≠ 검증 완료** — 검색 쿼터 소진, 3자 데이터 소스 차단
3. **금액 공백** — Poki 정액 피, 최소지급, 지급 시점 전부 NDA 뒤. CrazyGames 실제 셰어율도 미확인
4. **정의 공백** — Poki `earnings` 미정의 → 100%/50%로 실효 수취액 역산 불가. 어트리뷰션 로직 비공개·비감사
5. **시점** — 전 소스 2026-08-05 라이브 페치. GD 약관 2025-06-19판, CrazyGames 개발자 약관 2025-08-18판, **sdk.poki.com/deals에는 갱신일 표기 없음**(유일한 약점)

---

## 5. 미해결 질문 (다음 라운드 우선순위)

1. **웹 3D 레이싱의 실제 광고 RPM/eCPM은 얼마인가** — 전체 수익 모델링의 유일한 미지수이자 단 한 건도 1차 검증을 통과하지 못한 항목. 차단·쿼터가 직접 원인이므로 **재조사 가치 최상**
2. **CrazyGames·GameDistribution의 실제 레버뉴셰어 비율** — 셰어율 비교 없이는 포털 선택 의사결정이 불가능
3. **Poki 비독점 정액 라이선스 피와 CrazyGames 선급금의 실제 금액대** — 공개 문서로 산정 불가. **포털 BD 담당자 직접 문의** 또는 실제 계약 경험 개발자 증언만이 답할 수 있음
4. Poki 독점 하에서 모바일 웹/PWA가 배제될 때 채널 (c)의 실효 옵션은 네이티브 랩핑뿐인가 — 앱스토어 심사·ASO 비용 대비 실익은?
5. Poki 기준(중급폰 30FPS / 85% 무장애)을 맞추는 데 실제로 필요한 렌더링 예산과, 그 최적화가 3개월 일정에서 몇 주를 잡아먹는가

---

## 6. 이 리서치가 PRD에 강제하는 것

| 리서치 사실 | PRD 반영 |
|---|---|
| 수익 수치 근거 전무 | 성공 지표를 **매출이 아닌 "RPM 실측"**으로 정의 |
| €100 + 60일 | **최소 5개월 무수입 가정.** 런웨이 설계에 반영 |
| Poki 5년 독점 락인 | **데이터 확보 전 독점 계약 금지.** 멀티배포로 측정 먼저 |
| 중급폰 30FPS / 85% | 렌더 예산을 **저사양 안드로이드 기준으로 고정.** 후처리 사실상 포기 |
| 모바일 웹이 Poki 독점에 저촉 | 채널 (c)는 **Phase 2 이후, 네이티브 랩핑만** |
| Kenney CC0 무료 | 아트비 $0, 단 **차별화를 위한 셰이더/컬러 그레이딩 자체 작업 필수** |
| Slow Roads 5년 | 스코프를 **절차생성 월드가 아닌 고정 트랙**으로 못박음 |
