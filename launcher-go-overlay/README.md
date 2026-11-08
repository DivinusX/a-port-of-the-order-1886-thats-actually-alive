# launcher-go overlay

Files copied over upstream `launcher-go/` (JulioCacko/The-Order-1886_pc) before building the
launcher. **As of the windows-port branch these are vendored into the source repo itself**
(`launcher-go/music.go`, `launcher-go/ui_wails.go`, `launcher-go/order1886-frontend/`) and
staged by both CI workflows; this directory stays as the release-side copy and the build
recipe. Build with the frontend from `launcher-frontend/` (do not run the frontend build;
`frontend/src` upstream is the older sidebar UI):

```sh
cp launcher-go-overlay/*.go <upstream>/launcher-go/
rm -rf <upstream>/launcher-go/frontend/dist && cp -r launcher-frontend <upstream>/launcher-go/frontend/dist
cd <upstream>/launcher-go
wails build -s -tags webkit2_41 -platform linux/amd64 -o order1886-launcher   # Linux window
wails build -s -platform windows/amd64                                          # Windows exe
```

- `music.go`: launcher music (track from `<installation>/music`, volume/mute in the state folder).
- `ui_wails.go`: registers the music handler on the Wails asset server.
