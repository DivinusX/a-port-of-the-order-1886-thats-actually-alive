# THE ORDER: 1886 FOR PC — WINDOWS (x86-64)

Unofficial, emulator-backed compatibility software: the original PS4 executable runs on a
dedicated runtime with a Vulkan renderer derived from shadPS4. This is not an official PC
port. No game content is included — use your own extracted copy.

Port status: this Windows package is produced by the project's Windows CI from the same
source as the Linux build. It has not yet completed the full manual test pass on physical
hardware — read [What is not verified yet](#what-is-not-verified-yet) before judging a
problem as a bug, and see `docs/verification/2026-11-08-windows-port-checklist.md`.

## New in v0.2.22

- **Black stripes on RX 6600-class GPUs (RDNA2) fixed** — on AMD's Windows driver the game's
  multisampled depth was read half-empty, which drew 4-row dark bands on everything the sun
  lit, on the logos and on the main menu ([#4](https://github.com/DivinusX/a-port-of-the-order-1886-thats-actually-alive/issues/4)).
  On that driver the runtime now renders those buffers single-sampled; every other GPU and
  driver is untouched. The newest `user/order1886/logs/*-boot.log` says
  `GPU: guest multisampling off (single-sampled images for this driver; ...)` when the fix
  is active. **Not yet confirmed on an RX 6600 by us** — if you own one, please report back
  on #4 with that log line and a screenshot.
- **In-game menu on F1** (or R3+L2 on a controller): frame rate (30/60/90/120/144/165/240/
  Unlocked), window mode, V-Sync, output resolution and the FPS counter change while you
  play. On by default (Performance → *In-game menu (F1)*).
- **Game language** (Game & Content → *Game language*): 21 languages including Español
  (Latinoamérica); before, every language came out in English. The game needs that
  language's assets in your dump.
- Copies whose `eboot.bin` already carries the published 60 FPS or 16:9 patch are accepted,
  and 30 FPS really runs at 30 on them ([#3](https://github.com/DivinusX/a-port-of-the-order-1886-thats-actually-alive/issues/3)).
- Launcher: the search magnifier is centred and the missing logo images are in.

## Requirements

- Windows 10 (1903 or newer) or Windows 11, x86-64. ARM64 is not supported.
- A Vulkan-capable GPU with a current driver (NVIDIA, AMD or Intel). Vulkan comes with the
  graphics driver; nothing to install separately.
- Microsoft Edge WebView2 Runtime for the launcher window — built into Windows 11 and into
  kept-up-to-date Windows 10. If it is missing, Windows offers to install it; playing the
  game does not need it (`Play The Order 1886.exe` works without the window).
- No Python, no MSYS2, no Visual C++ redistributable: every runtime library the build needs
  is inside the package.
- No firewall rules needed: the runtime never listens on a port and the launcher only makes
  outbound HTTPS when you press Check for updates.
- Your own extracted game folder that directly contains `eboot.bin`, `archivemap.bin`,
  `_data`, `sce_sys` and `sce_module` (CUSA00076 tested; CUSA00035, CUSA00070, CUSA00100,
  CUSA00670, CUSA00785 experimental). Update 1.02 optional. The original files are only
  read, never modified.

## Setup

1. Extract the whole zip to a writable folder (not to `Program Files`). Keep
   `The Order 1886.exe`, `Play The Order 1886.exe` and `bin` together.
2. First run: Windows SmartScreen may say "Windows protected your PC" — choose
   **More info → Run anyway** (the app is unsigned, like the Linux build is un-notarized).
3. Open `The Order 1886.exe`, pick your game folder on **Game & Content**, press **Play**.
   Or skip the window: `Play The Order 1886.exe` starts with the saved configuration.
4. Settings, saves, logs and caches live in `user/order1886` next to the launcher. When
   updating, copy that folder into the new extraction.

## Graphics options that matter

- **Render resolution** — the game draws natively at the chosen size; 3840 wide is native
  4K, no upscaler involved.
- **Upscaling → AMD FSR 4** — replaces the game's temporal anti-aliasing with the FSR 4 v07
  model (needs the `bin/fsr4` bundle inside the package; if your GPU cannot run the INT8/DOT4
  shaders, FSR 3.1 is used automatically and the log says why).
- **Sun shadow readback sync** — keep **Staging (recommended)**. It is what ends the sun and
  shadow flicker in The Chase; *Synchronous drain* is the old v0.2.9 behaviour, *Off* the
  v0.2.10 one.
- **HTILE draw expand** — keep it **on**: it restores the sun's shadows and the wet-stone
  specular.
- **Cinematic bars** — off by default; 60 FPS modes are experimental.

## Controllers

- **Xbox pads**: XInput is built into Windows — wired or wireless Xbox One/Series pads work
  with no setup.
- **DualShock 4 / DualSense / generic HID pads**: handled by the runtime's SDL layer; the
  button prompts follow the pad's own labels.
- **Keyboard**: space is ✕, Enter is Options — enough to play without a pad.
- **Steam is running and buttons do nothing?** Steam Input can own the controller: quit
  Steam while playing, or disable Steam Input for that controller family in
  Steam → Settings → Controllers.
- On every real game start the runtime prints a pad check to its log
  (`user/order1886/logs`, lines starting with `Order1886: pad check:`): how many pads it
  opened, which XInput slots are live, and what to do when a pad is connected but unusable.

## Troubleshooting

- **Launcher window does not open** — install the WebView2 runtime (see Requirements), or
  use `Play The Order 1886.exe` directly.
- **Game window is black or crashes at once** — update the GPU driver; then try Graphics →
  Upscaling = *None* and *Sun shadow readback sync = Off* to isolate, and send
  `user/order1886/logs` (the newest `-boot.log`).
- **"provider … is not next to the runtime"** in the log — the extraction is incomplete:
  `bin/order1886_fsr3.dll` / `order1886_fsr4.dll` must be where they were shipped.
- **FSR 4 shows as unsupported** — expected on GPUs without `shader-mixed-float-dot-product`
  (most NVIDIA before RTX, older AMD/Intel): FSR 3.1 keeps working.
- **System → Updates says nothing is available** — expected: this fork publishes releases
  without an updater receipt, so updates are manual by design: download the new zip, extract
  to a new folder, copy your `user` folder over.
- **Antivirus flags the download** — unsigned PyInstaller/MinGW binaries trip heuristics;
  verify the `.sha256` next to the zip and add an exclusion if you trust the source.

## Credits

Main Maintainer: **DivinusX** (https://github.com/DivinusX) — this fork's releases, hardware
verification and funding. Upstream base project by JulioCacko; see `notices/ATTRIBUTION.txt`.

## What is not verified yet

Everything below is shipped as built-by-CI but untested on physical Windows hardware at the
time of writing. Each item is a line in the manual checklist. Partial credit from a local
cross-build (Linux + wine, same day): the runtime exe and both provider DLLs compile and
link for Windows, and the runtime answers `--runtime-info`, `--cpu-features`, `--gamepad`,
`--input-options` and prints the pad-check line under wine — but no game was booted:

- First launch, folder pick and Play on Windows 10 and 11 (both entry points).
- FSR 4 on Windows (provider load, bundle discovery, capability gate, fallback to FSR 3.1)
  — the DLL builds; its GPU path never ran.
- The pad check output with Xbox, DualSense and Steam running/closed (the no-pad branch
  already prints correctly under wine).
- Saves, resume, trophies display, long sessions, 4K/60, borderless behaviour on
  multi-monitor and HDR setups, SmartScreen/Defender experience.
- The sun-flicker fix itself on Windows: identical code path to Linux (verified there with
  0 brightness flips), but the Windows page-protection and driver stack differ.
- The RDNA2 stripes fix (v0.2.22) on a real RX 6600 / 6650 XT with the AMD driver: the
  code is the one that fixed the same lines for five owners of those cards in another PS4
  port on this emulator core, and the per-driver switch is unit-tested, but no RDNA2 card
  was available here. The log line to look for is in *New in v0.2.22*.
- The in-game menu and the game language selector were verified on Linux (CUSA00035); on
  Windows they are the same code, booted under wine only.

---

# THE ORDER: 1886 PARA PC — WINDOWS (x86-64) — EM PORTUGUÊS

Software não-oficial de compatibilidade baseado em emulador: o executável original de PS4
roda em um runtime dedicado com renderizador Vulkan derivado do shadPS4. Não é um port
oficial. Nenhum conteúdo de jogo está incluído — use sua própria cópia extraída.

## Novidades da v0.2.22

- **Listras pretas em GPUs da classe RX 6600 (RDNA2) corrigidas** — no driver AMD do
  Windows, a profundidade multiamostrada do jogo era lida pela metade, desenhando faixas
  escuras de 4 linhas em tudo que o sol iluminava, nos logos e no menu principal
  ([#4](https://github.com/DivinusX/a-port-of-the-order-1886-thats-actually-alive/issues/4)).
  Nesse driver o runtime agora renderiza esses buffers com uma amostra; as demais GPUs e
  drivers não mudam. O `*-boot.log` mais novo em `user/order1886/logs` mostra
  `GPU: guest multisampling off (...)` quando a correção está ativa. **Ainda não confirmada
  por nós numa RX 6600** — se você tem uma, responda na #4 com essa linha e uma captura.
- **Menu dentro do jogo no F1** (ou R3+L2 no controle): taxa de quadros, modo de janela,
  V-Sync, resolução de saída e contador de FPS mudam durante o jogo. Ligado por padrão.
- **Idioma do jogo** (Game & Content → *Game language*): 21 idiomas, incluindo Español
  (Latinoamérica) e Português (Brasil); antes, todo idioma saía em inglês. O jogo precisa
  ter os arquivos daquele idioma no seu dump.
- Cópias cujo `eboot.bin` já traz o patch público de 60 FPS ou 16:9 são aceitas, e 30 FPS
  roda mesmo a 30 nelas (#3).

## Requisitos

- Windows 10 (1903 ou mais novo) ou Windows 11, x86-64. ARM64 não é suportado.
- GPU com Vulkan e driver atualizado (NVIDIA, AMD ou Intel). O Vulkan vem com o driver.
- Microsoft Edge WebView2 Runtime para a janela do lançador — já vem no Windows 11 e no
  Windows 10 atualizado. Faltando, o Windows oferece instalar; jogar não precisa dela
  (`Play The Order 1886.exe` funciona sem janela).
- Sem Python, sem MSYS2, sem redistribuível do Visual C++: todas as bibliotecas do runtime
  estão dentro do pacote.
- Nenhuma regra de firewall é necessária: o runtime nunca escuta portas e o lançador só faz
  HTTPS de saída quando você clica em Check for updates.
- Sua própria pasta de jogo extraída, contendo diretamente `eboot.bin`, `archivemap.bin`,
  `_data`, `sce_sys` e `sce_module` (CUSA00076 testado; CUSA00035, CUSA00070, CUSA00100,
  CUSA00670 e CUSA00785 experimentais). Atualização 1.02 opcional. Os arquivos originais
  são apenas lidos, nunca modificados.

## Instalação

1. Extraia o zip inteiro para uma pasta gravável (não em `Program Files`). Mantenha
   `The Order 1886.exe`, `Play The Order 1886.exe` e `bin` juntos.
2. Na primeira execução, o SmartScreen pode dizer "O Windows protegeu seu PC" — escolha
   **Mais informações → Executar assim mesmo** (o app não é assinado).
3. Abra `The Order 1886.exe`, escolha a pasta do jogo em **Game & Content** e clique
   **Play**. Ou pule a janela: `Play The Order 1886.exe` inicia com a configuração salva.
4. Configurações, saves, logs e caches ficam em `user/order1886` ao lado do lançador.
   Ao atualizar, copie essa pasta para a nova extração.

## Opções de vídeo importantes

- **Render resolution** — o jogo desenha nativamente no tamanho escolhido; 3840 de largura
  é 4K nativo, sem upscaler.
- **Upscaling → AMD FSR 4** — substitui o anti-aliasing temporal do jogo pelo modelo
  FSR 4 v07 (precisa do pacote `bin/fsr4` incluído; se a GPU não rodar os shaders
  INT8/DOT4, o FSR 3.1 é usado automaticamente e o log explica).
- **Sun shadow readback sync** — deixe em **Staging (recommended)**: é o que acaba com o
  flicker de sol e sombras n'As Caçada (The Chase); *Synchronous drain* é o comportamento
  antigo da v0.2.9, *Off* é o da v0.2.10.
- **HTILE draw expand** — deixe **ligado**: devolve as sombras do sol e o reflexo molhado
  do calçamento.
- **Cinematic bars** — desligadas por padrão; modos 60 FPS são experimentais.

## Controles

- **Controles Xbox**: XInput já existe no Windows — Xbox One/Series com fio ou sem fio
  funcionam sem configuração.
- **DualShock 4 / DualSense / HID genéricos**: tratados pela camada SDL do runtime; os
  prompts seguem os rótulos do próprio controle.
- **Teclado**: espaço é ✕, Enter é Options — dá para jogar sem controle.
- **Steam aberto e os botões não fazem nada?** O Steam Input pode estar tomando o
  controle: feche o Steam ao jogar, ou desative o Steam Input para essa família de
  controles em Steam → Configurações → Controles.
- A cada inicialização real o runtime imprime uma checagem de controle no log
  (`user/order1886/logs`, linhas que começam com `Order1886: pad check:`): quantos
  controles abriram, quais slots XInput estão vivos e o que fazer quando um controle está
  conectado mas inutilizável.

## Solução de problemas

- **A janela do lançador não abre** — instale o WebView2 (ver Requisitos) ou use
  `Play The Order 1886.exe` direto.
- **Janela preta ou crash imediato** — atualize o driver da GPU; depois teste Graphics →
  Upscaling = *Nenhum* e *Sun shadow readback sync = Off* para isolar, e envie o
  `user/order1886/logs` (o `-boot.log` mais recente).
- **"provider … is not next to the runtime"** no log — extração incompleta:
  `bin/order1886_fsr3.dll` / `order1886_fsr4.dll` precisam estar onde foram empacotados.
- **FSR 4 aparece como não suportado** — esperado em GPUs sem
  `shader-mixed-float-dot-product` (quase todas as NVIDIA pré-RTX, AMD/Intel antigas):
  o FSR 3.1 continua funcionando.
- **Sistema → Atualizações diz que nada está disponível** — esperado: este fork publica
  releases sem recibo do atualizador, então atualizar é manual: baixe o novo zip, extraia
  em pasta nova e copie a pasta `user` para junto do novo executável.
- **Antivírus marca o download** — binários PyInstaller/MinGW não assinados disparam
  heurísticas; confira o `.sha256` ao lado do zip e crie uma exclusão se confiar na origem.

## Créditos

Maintainer principal: **DivinusX** (https://github.com/DivinusX) — os releases deste fork,
a verificação em hardware real e o financiamento. Projeto base upstream por JulioCacko;
veja `notices/ATTRIBUTION.txt`.

## O que ainda não foi verificado

Tudo abaixo é empacotado pela CI mas ainda sem teste em hardware Windows físico:
primeira execução e Play no Windows 10 e 11; FSR 4 no Windows; a checagem de controles com
Xbox/DualSense e com o Steam aberto/fechado; saves, troféus, sessões longas, 4K/60,
multimonitor/HDR, SmartScreen/Defender; e o próprio fim do flicker no Windows (mesmo código
da v0.2.17, verificado no Linux com 0 inversões de brilho). A correção das listras RDNA2
(v0.2.22) ainda não foi vista numa RX 6600 real: é o mesmo código que resolveu as mesmas
linhas para cinco donos dessas placas em outro port de PS4 deste núcleo, mas nenhuma placa
RDNA2 estava disponível aqui. O menu no F1 e o seletor de idioma foram verificados no Linux;
no Windows só sob wine.
