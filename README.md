# oNetwork

Omegle-style random video chat for speed networking. Upload a resume, check what it found, and get paired for a timed call with someone in a similar field. If you both click Connect, you swap contact details.

## Run it

Requires Node 20 or newer.

```bash
npm install
npm start          # http://localhost:3000
npm test
```

To try it alone, open two browser tabs (each tab is its own user) and upload `samples/maya-chen.txt` in one and `samples/liam-okafor.txt` in the other. They match straight away. To shorten rounds while testing, run `ROUND_SECONDS=20 npm start`.

Settings are listed in `.env.example`.

## How it works

**Resume parsing** (`server/resume.js`) takes PDF, DOCX and TXT files. If `ANTHROPIC_API_KEY` is set, Claude extracts the profile. Otherwise, or if that call fails, a built-in keyword parser does it. The keyword parser is less accurate on unusual layouts, which is one reason people review their profile before joining. Scanned PDFs have no text to read, so those users enter details by hand.

**Matching** (`server/matching.js`, `server/lobby.js`) scores each waiting pair from 0 to 100:

| Signal | Points |
| --- | --- |
| Same main industry | 50 |
| Other shared industry | 35 |
| Each further shared industry | +5 (up to 10) |
| Related industry, if none are shared | 20 |
| Same school | 15 |
| Same company | 15 |
| Same field of study | 5 |
| Similar job titles | up to 10 |
| Shared skills | up to 10 |

The bar drops as people wait: a score of 50 or more for the first 15 seconds, then 20 or more, then anyone after 60 seconds. Without that last step, a quiet site would leave people waiting forever. Both people have to have waited long enough for the score. Reasons like "Both went to Carnegie Mellon University" appear on screen as conversation starters.

**Calls** use WebRTC, so video goes directly between browsers and the server only relays setup messages and text chat. Users without a camera can join by text.

## Privacy and safety

- Resume files are held in memory while being parsed and are never written to disk. If Claude is enabled, the resume text is sent to the Anthropic API, and the upload page says so.
- During a call, the other person sees a first name and work history. Contact details are shared only after both people click Connect.
- Users must confirm they are 18 or older. Reporting someone ends the call and blocks that pair from matching again. After reports from 3 different people, that person is removed.

## Before launching publicly

This is an MVP. Everything is in memory on one server, so a restart logs everyone out. Before opening it to real users, you need:

1. **Accounts and verification.** Without them, the age check is only a checkbox, and someone who is removed can come straight back with a new profile. LinkedIn or work email sign-in would suit this product.
2. **Moderation.** Omegle shut down in 2023 after sustained abuse and legal pressure. Reports currently only go to the server log, so nobody reviews them. You need a review process, a way to report illegal content, and legal advice.
3. **TURN servers.** The default public STUN server isn't enough on many corporate and mobile networks, and video will fail there. Set `ICE_SERVERS`.
4. **HTTPS.** Browsers only allow camera access on HTTPS or localhost.
5. **Redis or a database** if you run more than one server instance.
6. **A privacy policy and terms**, since you are handling resumes and live video.
