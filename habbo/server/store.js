// Sauvegarde sur disque (fichier JSON) des comptes, inventaires et mobis poses.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const START_CREDITS = 500;

export class Store {
  constructor(file) {
    this.file = file;
    this.data = { nextItemId: 1, users: {}, rooms: {} };
    this.getRooms = () => ({});
    this.timer = null;
    if (file && fs.existsSync(file)) {
      try {
        this.data = { ...this.data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
      } catch (err) {
        console.error(`Sauvegarde illisible (${file}), on repart de zero :`, err.message);
      }
    }
  }

  /** Cle de compte derivee du jeton secret du navigateur (le jeton n'est jamais stocke). */
  static keyFor(token) {
    return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
  }

  user(key) {
    if (!this.data.users[key]) {
      this.data.users[key] = { name: '', credits: START_CREDITS, inventory: [] };
      this.saveSoon();
    }
    return this.data.users[key];
  }

  nextItemId() {
    const id = this.data.nextItemId++;
    this.saveSoon();
    return id;
  }

  roomItems(roomId) {
    return this.data.rooms[roomId];
  }

  saveSoon() {
    if (!this.file || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.saveNow();
    }, 1000);
  }

  saveNow() {
    if (!this.file) return;
    clearTimeout(this.timer);
    this.timer = null;
    this.data.rooms = this.getRooms();
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}
