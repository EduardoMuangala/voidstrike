import { supabase } from './supabase';

export type PeerStatus = 'connecting' | 'connected' | 'closed';

export interface PeerLink {
  id: string;
  status: PeerStatus;
  ping: number | null;
}

interface SignalMsg {
  to: string;
  from: string;
  kind: 'offer' | 'answer' | 'ice';
  sdp?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
}

// Public, free STUN servers — just for NAT traversal discovery, no game traffic goes through them.
const ICE_SERVERS: RTCIceServer[] = [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }];

interface Link {
  pc: RTCPeerConnection;
  dc: RTCDataChannel | null;
  status: PeerStatus;
  ping: number | null;
  pingTimer: number;
}

/**
 * Direct peer-to-peer connections between everyone in a room, star-shaped
 * around the host. Supabase Realtime Broadcast is only the "introduction
 * service" (it carries the WebRTC offer/answer/ICE candidates) — once
 * connected, game traffic goes straight between browsers, not through Supabase.
 */
export class RoomNet {
  private channel: ReturnType<typeof supabase.channel>;
  private links = new Map<string, Link>();
  onUpdate: (peers: PeerLink[]) => void = () => {};
  onMessage: (fromId: string, data: unknown) => void = () => {};

  private selfId: string;
  private isHost: boolean;
  private hostId: string;

  constructor(roomId: string, selfId: string, isHost: boolean, hostId: string) {
    this.selfId = selfId;
    this.isHost = isHost;
    this.hostId = hostId;
    this.channel = supabase.channel(`webrtc:${roomId}`, { config: { broadcast: { self: false } } });
    this.channel.on('broadcast', { event: 'signal' }, ({ payload }) => this.onSignal(payload as SignalMsg));
    this.channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' && !this.isHost) this.connectToHost();
    });
  }

  private send(msg: SignalMsg) {
    this.channel.send({ type: 'broadcast', event: 'signal', payload: msg });
  }

  private openLink(peerId: string): Link {
    this.links.get(peerId)?.pc.close();
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const link: Link = { pc, dc: null, status: 'connecting', ping: null, pingTimer: 0 };
    this.links.set(peerId, link);
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send({ to: peerId, from: this.selfId, kind: 'ice', candidate: e.candidate.toJSON() });
    };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed' || pc.connectionState === 'disconnected') {
        link.status = 'closed';
        this.notify();
      }
    };
    return link;
  }

  private wireDataChannel(peerId: string, dc: RTCDataChannel) {
    const link = this.links.get(peerId);
    if (!link) return;
    link.dc = dc;
    dc.onopen = () => {
      link.status = 'connected';
      this.notify();
      link.pingTimer = window.setInterval(() => {
        if (dc.readyState === 'open') dc.send(JSON.stringify({ t: 'ping', n: performance.now() }));
      }, 2000);
      dc.send(JSON.stringify({ t: 'ping', n: performance.now() }));
    };
    dc.onclose = () => {
      link.status = 'closed';
      clearInterval(link.pingTimer);
      this.notify();
    };
    dc.onmessage = (e) => {
      let msg: { t: string; n?: number };
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      if (msg.t === 'ping') dc.send(JSON.stringify({ t: 'pong', n: msg.n }));
      else if (msg.t === 'pong' && typeof msg.n === 'number') {
        link.ping = Math.max(0, Math.round(performance.now() - msg.n));
        this.notify();
      } else this.onMessage(peerId, msg);
    };
  }

  private connectToHost() {
    const link = this.openLink(this.hostId);
    const dc = link.pc.createDataChannel('game');
    this.wireDataChannel(this.hostId, dc);
    link.pc
      .createOffer()
      .then((offer) => link.pc.setLocalDescription(offer))
      .then(() => this.send({ to: this.hostId, from: this.selfId, kind: 'offer', sdp: link.pc.localDescription! }));
  }

  private async onSignal(msg: SignalMsg) {
    if (msg.to !== this.selfId) return;
    if (msg.kind === 'offer' && this.isHost) {
      const link = this.openLink(msg.from);
      link.pc.ondatachannel = (e) => this.wireDataChannel(msg.from, e.channel);
      await link.pc.setRemoteDescription(msg.sdp!);
      const answer = await link.pc.createAnswer();
      await link.pc.setLocalDescription(answer);
      this.send({ to: msg.from, from: this.selfId, kind: 'answer', sdp: link.pc.localDescription! });
    } else if (msg.kind === 'answer') {
      await this.links.get(msg.from)?.pc.setRemoteDescription(msg.sdp!);
    } else if (msg.kind === 'ice') {
      await this.links.get(msg.from)?.pc.addIceCandidate(msg.candidate!).catch(() => {});
    }
  }

  /** Send to everyone directly connected (for the host: all guests; for a guest: just the host). */
  broadcast(data: unknown) {
    for (const link of this.links.values()) if (link.dc?.readyState === 'open') link.dc.send(JSON.stringify(data));
  }

  private notify() {
    this.onUpdate(Array.from(this.links.entries()).map(([id, l]) => ({ id, status: l.status, ping: l.ping })));
  }

  dispose() {
    for (const link of this.links.values()) {
      clearInterval(link.pingTimer);
      link.dc?.close();
      link.pc.close();
    }
    this.links.clear();
    supabase.removeChannel(this.channel);
  }
}
