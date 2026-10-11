# Karl: how it works (about 45 seconds)

One voice, ~115 words. Show a simple pipeline diagram or the dashboard while talking.

> So here's how Karl actually works. Photon is our iMessage connection. It gets your texts to our Bun server on Railway and sends Karl's replies back.
>
> Every text first hits an intent classifier. Mid-deal, it decides if you're talking to Karl or the other person, and relays it safely without sharing numbers.
>
> Simple replies like "yes" or "stop" are handled in plain code. Gemini only gets called when we need it, like reading a photo or a request.
>
> For matching, we search by meaning, not exact words. So "something to keep drinks cold" still finds a mini fridge.
>
> It's human-in-the-loop: nothing goes live or gets held until you say yes.
>
> And it's long-horizon. Karl remembers what you want for a week and texts you when it shows up.
