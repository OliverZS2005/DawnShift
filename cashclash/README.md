# 💰 Cash Clash

A money tycoon with a top-down arena shooter. Win a battle and you take 10% of your opponent's money; lose and they take 10% of yours.

## Singleplayer
Open `index.html` in a browser. It runs entirely on your PC and you fight computer rivals.
You get exactly one singleplayer game. You can reset it from the 🎮 Play tab, but you can't create another.

## Multiplayer
In 🎮 Play, enter a server address and join. The first time you join a server, you choose:
- **New multiplayer tycoon**: start fresh, and use that tycoon only on this server.
- **Import singleplayer tycoon**: copy your singleplayer progress to the server. Your singleplayer game keeps its own copy.

The server remembers you through a token stored in your browser, so the next time you join you go straight back in.

## Host your own server
```
cd cashclash
npm install
npm start          # http://localhost:8080
```
Players can open `http://<your-ip>:8080` or type that address into the Play tab.

| Env var | Default | Meaning |
|---|---|---|
| `PORT` | 8080 | Port to listen on |
| `SERVER_NAME` | Cash Clash Server | Name shown to players |
| `DATA_FILE` | ./players.json | Where player profiles are saved |
| `ALLOW_IMPORT` | 1 | Set to `0` to forbid importing singleplayer saves (they're edited locally, so players could cheat) |

The server controls money, purchases, matchmaking and the battle simulation, so clients can only send inputs.
Matchmaking pairs the queued players whose wealth is closest on a log scale. The range it accepts widens the longer they wait.
