# Design findings

Designer posts Cajun App Factory website findings here. This is not the MyStops list. MyStops findings stay in `df9259/boxline` `docs/design.md`.

This is not a work order. A row is not accepted until Dominic okays it.

## Rules

- Repo is `df9259/cajunappfactory`, branch `main`.
- This file is the website only. Do not write MyStops screens here.
- One finding per row. Next id is `DS-001`.
- Never reuse an id.
- Status is `open` or `dropped`.
- Name the page. Put the screenshot path in the Screenshot column when there is one.
- Do not edit the site pages from this file.

## Table

| ID | Page | Finding | Screenshot | Status |
| --- | --- | --- | --- | --- |
| DS-001 | /mystops/ app screenshots | Phone mockups show the old green app (green tabs, green Add stop button, green numbered circles, mint route line); current app is dark amber with no green controls. Retake from the current build (0.2.25 or later). | `/workspace/cajun-site-shots/03-mystops-top.png`, `/workspace/cajun-site-shots/04-mystops-lower.png` | open |
| DS-002 | /mystops/ app screenshots | Stop addresses are blurred into gray smudges and labels are too small to read. Use readable fake addresses at a larger crop, one screen per phone, with a short caption. | `/workspace/cajun-site-shots/04-mystops-lower.png` | open |
| DS-003 | /mystops/ hero | "Coming soon on Google Play" is a dashed outline that reads as a disabled button. Add one line saying what to expect (e.g. Free to start, 15 stops) and make it a plain label, not a button shape. | `/workspace/cajun-site-shots/03-mystops-top.png` | open |
| DS-004 | Home and /mystops/ brand color | Site uses orange (#fdba74-style) plus mint green (#86efac) for the stop 3 end dot; the app uses amber #F5B942 and has no green controls. Switch site accent to the app amber and drop the green end dot (CSS vars --accent, --ok, .map .dot-end). | `/workspace/cajun-site-shots/01-home-top.png` | open |
| DS-005 | Header, all pages | No real nav; home shows only a MyStops link, /mystops/ shows only Privacy policy, so links change per page; links are ~14 px text. Show the same items everywhere (MyStops, Privacy, Support) with tap height at least 44 px. | `/workspace/cajun-site-shots/01-home-top.png`, `/workspace/cajun-site-shots/03-mystops-top.png`, `/workspace/cajun-site-shots/m01-home-top.png` | open |
| DS-006 | Home hero | Copy fills only the left half, big empty area right, app card below the fold on a laptop. Move the route art up beside the headline or tighten top padding so the card shows without scrolling. | `/workspace/cajun-site-shots/01-home-top.png` | open |
| DS-007 | Home app card | Whole card is one link but the only cue is small "See how it works" text, styled similar in size and weight to the Coming soon pill. Make it a real button distinct from the pill. | `/workspace/cajun-site-shots/01-home-top.png` | open |
| DS-008 | Home and /mystops/ small type | Eyebrow labels (~12 px orange caps) and footer links are small and tightly spaced. Raise footer links to 16 px with more spacing. | `/workspace/cajun-site-shots/02-home-bottom.png` | open |
| DS-009 | Home on phone | The route-art panel is large and pushes How we build a full screen down. Cap its height at about 160 px on narrow screens. | `/workspace/cajun-site-shots/m03-home-lower.png` | open |
| DS-010 | All pages, favicon | /favicon.ico returns 404 so no tab icon. Add a favicon from the app icon. | none | open |
