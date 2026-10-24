# OPL / OpenP2P Multiplayer Guide

> English | [中文](./OPL联机说明.md)

Dark Forest's server listens on **one TCP port, 3001 by default**. The HTTP page and the WebSocket `/ws` share this port.

## Conclusion

- **It is not the room port that needs to be random.** A room code is a logical room, not a port; all rooms share the server's port 3001.
- **The host (the side being connected to) does not need to create a tunnel.** OPL's rule is "the side being connected only needs to start directly without a tunnel and provide its UID and port number".
- The one that needs a tunnel is the **joining side**: fill in the host UID, remote port 3001, local forwarding port, protocol TCP, then enable it.
- Your machine's OPL configuration has an old set of `37520` custom tunnels, and `Enabled: 0`; that set is not this game, so the host can stay tunnel-free.

## Method A: OPL Custom TCP Tunnel (try this first)

### Host

1. Open OPL and stay online; **do not create/enable a tunnel** (especially do not open the old 37520 tunnel);
2. Double-click `start.bat` and confirm the log shows `http://localhost:3001`;
3. Send the **OPL UID** and **remote port 3001** to the joining side; the connection code is not needed;
4. Do not map 3001 to 3001 locally on the host—it will fight the game server for the port.

### Joining Side

In OPL click "New Tunnel" and fill in:

- Field: peer UID; value: the host's OPL UID
- Field: remote port; value: **3001**
- Field: local/LAN port; value: **3001** (use 30001 if local 3001 is taken)
- Field: protocol; value: TCP
- Field: target address; value: `127.0.0.1` / `localhost`

Click "Create", then **enable** the tunnel. Once the status light turns green / the log shows "tunnel local port ... connected", open in the browser:

    http://127.0.0.1:3001

If the local forwarding port you filled in is 30001, open `http://127.0.0.1:30001`.

The "Local/Local port" in the OPL panel is the port the browser must visit; the "remote port" is the host game server's 3001.
Do not put the UID into the "connection code/join code" input box; that one is the MC auto-join code, and the UID is not a connection code.

## Common Symptoms

- Log "unrecognized connection code": the UID was put into the connection code input box; use "New Tunnel" instead.
- Log "the person you are connecting to is offline": the host's OPL is not started/the UID is wrong/not on the same OPL service.
- Log "tunnel local port ... connected" but the browser cannot open: check whether the host game is on 3001 and whether the host firewall allows Node/3001.
- The host can open `localhost:3001` fine but the joining side cannot: the game itself is fine; the problem is the OPL tunnel or the firewall.
- Two windows on the same machine can connect: they go through localhost, not OPL, so this does not prove OPL works.

## Method B: EasyTier Virtual LAN

If OPL's "networking" mode is available:

1. The host and the joining side join the same EasyTier network;
2. The host starts the game and notes the log and the host's virtual IP on the virtual adapter;
3. The joining side opens in the browser:

    http://{host virtual IP}:3001

Do not open `localhost:3001`—that is the joining side's own computer.

## Why Two Windows on the Same Machine Work

Two windows on the same machine go through `127.0.0.1:3001`, bypassing OPL, the network adapter, and the firewall, so it only proves the game itself works. Cross-machine failures are usually:

1. the joining side did not create/enable a tunnel, or put the UID into the connection code;
2. the OPL tunnel port is not 3001;
3. the host's Windows firewall does not allow Node/3001;
4. the two sides are not on the same OPL network/tunnel.

## Do Not Randomize Room Ports

If each room got a random port, OPL would have to rebuild a tunnel and re-enter the port for every match, which makes connecting harder. The current fixed 3001 is the most stable; when the port conflicts, change the server port with the `PORT` environment variable, then map the same port in OPL.
