#!/bin/zsh -l
# Ставит Ealzy на iPhone без платного аккаунта разработчика: Xcode + обычный Apple ID.
# Ограничения бесплатной учётки Apple: приложение работает 7 дней (потом запустить
# этот скрипт снова — данные сохранятся), нет push-уведомлений от сервера.
# Точные напоминания, календарь, виджеты, Siri и «Поделиться» работают.
set -u
cd "$(dirname "$0")/.." || exit 1
IOS_DIR="$PWD"
pause() { echo; read -k 1 "?Нажми любую клавишу, чтобы закрыть."; echo; }
fail() { echo; echo "СТОП: $1"; pause; exit 1; }
step() { echo; echo "== $1 =="; }

step "1/6 Xcode"
if ! xcodebuild -version >/dev/null 2>&1; then
  open "macappstore://apps.apple.com/app/id497799835" 2>/dev/null
  fail "нужен Xcode (бесплатно, App Store — уже открыл страницу). Установи, открой один раз, прими лицензию и запусти этот файл снова.
Если Xcode уже стоит: в Терминале выполни  sudo xcode-select -s /Applications/Xcode.app"
fi
xcodebuild -version | head -1

step "2/6 Apple ID в Xcode"
TEAM="${EALZY_TEAM_ID:-}"
if [[ -z "$TEAM" ]]; then
  # Xcode хранит команды учётки в настройках; у бесплатной учётки это «Personal Team».
  TEAM=$(defaults read com.apple.dt.Xcode IDEProvisioningTeamByIdentifier 2>/dev/null \
    | grep -Eo 'teamID = "?[A-Z0-9]{10}' | head -1 | grep -Eo '[A-Z0-9]{10}$')
fi
if [[ -z "$TEAM" ]]; then
  TEAM=$(defaults read com.apple.dt.Xcode IDEProvisioningTeams 2>/dev/null \
    | grep -Eo 'teamID = "?[A-Z0-9]{10}' | head -1 | grep -Eo '[A-Z0-9]{10}$')
fi
if [[ -z "$TEAM" ]]; then
  open -a Xcode 2>/dev/null
  fail "в Xcode не добавлен Apple ID. Xcode → Settings (⌘,) → Accounts → «+» → Apple ID → войди обычным Apple ID. Потом запусти этот файл снова."
fi
echo "   команда: $TEAM"

step "3/6 Генератор проекта"
XCODEGEN="$(command -v xcodegen || true)"
if [[ -z "$XCODEGEN" ]]; then
  TOOLS="$HOME/.ealzy-tools"
  XCODEGEN="$TOOLS/xcodegen/bin/xcodegen"
  if [[ ! -x "$XCODEGEN" ]]; then
    mkdir -p "$TOOLS"
    curl -fsSL -o "$TOOLS/xcodegen.zip" \
      https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.zip \
      || fail "не скачался XcodeGen (нет интернета?)."
    rm -rf "$TOOLS/xcodegen" && unzip -q -o "$TOOLS/xcodegen.zip" -d "$TOOLS" \
      || fail "не распаковался XcodeGen."
  fi
fi
"$XCODEGEN" generate --quiet || fail "проект не сгенерировался."
echo "   готово"

step "4/6 iPhone"
DEVICES_JSON="$(mktemp)"
xcrun devicectl list devices --json-output "$DEVICES_JSON" >/dev/null 2>&1
UDID=$(/usr/bin/python3 - "$DEVICES_JSON" <<'PY'
import json, sys
try:
    devices = json.load(open(sys.argv[1]))["result"]["devices"]
except Exception:
    devices = []
for d in devices:
    hw = d.get("hardwareProperties", {})
    conn = d.get("connectionProperties", {})
    if hw.get("platform") == "iOS" and hw.get("deviceType") == "iPhone" and conn.get("pairingState") == "paired":
        print(hw.get("udid", ""))
        break
PY
)
rm -f "$DEVICES_JSON"
if [[ -z "$UDID" ]]; then
  fail "не вижу iPhone. Подключи его кабелем, разблокируй и нажми «Доверять этому компьютеру».
Если просит — включи Режим разработчика: Настройки → Конфиденциальность и безопасность → Режим разработчика (iPhone перезагрузится). Потом запусти этот файл снова."
fi
echo "   $UDID"

# Идентификатор приложения должен быть своим для каждой учётки — добавляем код команды.
BUNDLE_ID="ru.ealzy.app.p$(echo "$TEAM" | tr '[:upper:]' '[:lower:]')"

step "5/6 Сборка (первая — минут 5–10)"
BUILT=""
for ENT in Personal Minimal; do
  set -o pipefail
  xcodebuild -project Ealzy.xcodeproj -scheme Ealzy -configuration Release \
    -destination "id=$UDID" -derivedDataPath build \
    -allowProvisioningUpdates \
    DEVELOPMENT_TEAM="$TEAM" CODE_SIGN_STYLE=Automatic \
    EALZY_BUNDLE_ID="$BUNDLE_ID" \
    CODE_SIGN_ENTITLEMENTS="$IOS_DIR/signing/$ENT.entitlements" \
    build 2>&1 | tee build.log | grep -E "error:|BUILD (SUCCEEDED|FAILED)"
  if grep -q "BUILD SUCCEEDED" build.log; then
    BUILT="$ENT"
    break
  fi
  echo "   вариант $ENT не подписался, пробую попроще…"
done
[[ -n "$BUILT" ]] || fail "сборка не прошла. Пришли Claude файл $IOS_DIR/build.log."
[[ "$BUILT" == "Minimal" ]] && echo "   внимание: учётка не дала общую связку ключей — виджет и «Поделиться» попросят открыть приложение."

step "6/6 Установка на iPhone"
APP="$IOS_DIR/build/Build/Products/Release-iphoneos/Ealzy.app"
xcrun devicectl device install app --device "$UDID" "$APP" || fail "не установилось. iPhone разблокирован?"
if ! xcrun devicectl device process launch --device "$UDID" "$BUNDLE_ID" >/dev/null 2>&1; then
  echo
  echo "Осталось один раз разрешить запуск на iPhone:"
  echo "  Настройки → Основные → VPN и управление устройством → твой Apple ID → «Доверять»."
  echo "После этого открой Ealzy на экране «Домой»."
fi
echo
echo "Готово. Ealzy на iPhone."
echo "Бесплатная учётка Apple даёт 7 дней: раз в неделю запускай этот файл снова — дела и вход сохранятся."
pause
