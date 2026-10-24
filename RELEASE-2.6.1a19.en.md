# Dark Forest · Release 2.6.1a19

> English | [中文](./RELEASE-2.6.1a19.md)

Release date: 2026-10-24  
Rulebook version: v1.0.0 (rules unchanged)

2.6.1a19 only adds collision ripples for the free-roaming idle light spot.

## I. Idle Light Spot

After the mouse leaves the window, the light spot enters free roaming.

Now when the light spot collides, it releases a light wave with the same effect as a click:

- hitting the outer boundary of the page;
- hitting an opaque control;
- hitting frosted glass and reflecting.

The light wave is generated at the collision point and uses the current ripple strength, natural decay, and color overlay settings.

## II. Debounce

Collision ripples have a 180ms cooldown:

- one collision releases only once;
- consecutive collisions along an edge do not spawn every frame;
- after the light spot leaves the obstacle, a new collision can trigger it again.

## III. Unchanged

Apart from collision ripples, all other effects remain as in 2.6.1a18:

- the three square glass panels on the main screen;
- glass at 0.97 on both faces;
- one-way mirror buttons;
- one-way frosted glass on Plains;
- colored border color overlay;
- natural decay;
- backlight preview;
- multiple ripples.

## IV. Verification

- the idle light spot produces a ripple after hitting the boundary;
- click ripples still work;
- no page errors;
- both the full version and the Lite version start.
