# 부자부자 공부방

뉴스 한 편으로 경제 근육 키우기. 정적 사이트(GitHub Pages) + 매일 자동 갱신(GitHub Actions).

## 올리는 법
1. GitHub에서 새 저장소 `bujabuja` 생성 → 이 폴더의 파일을 전부 업로드(`.github` 폴더 포함)
2. Settings → Pages → Branch: `main` / root 선택 → `https://<아이디>.github.io/bujabuja/`
3. Settings → Secrets and variables → Actions 에 등록
   - `ANTHROPIC_API_KEY` : 요약·개념·퀴즈 자동 생성용 (없으면 요약 대신 기사 도입부만 표시)
   - `YOUTUBE_API_KEY` : 관련 영상 자동 임베드용 (없으면 유튜브 검색 링크만 표시)
4. Actions 탭 → "매일 경제뉴스 업데이트" → Run workflow 로 첫 실행. 이후 매일 06:30(KST) 자동 갱신.

## 구조
- `index.html / style.css / app.js` : 화면 (홈 → 뉴스 → 기사 → 요약 → 개념+미니퀴즈 → 퀴즈 → 영상 → 보상)
- `data/news.json` : 오늘의 기사 데이터 (처음엔 샘플, Actions가 덮어씀)
- `scripts/update.mjs` : RSS 수집(한국경제·매일경제·구글뉴스) + 생성 로직
