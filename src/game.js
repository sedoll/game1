const GRID = 64;
const MAP_SIZE = 10;
const WIDTH = GRID * MAP_SIZE;
const HEIGHT = GRID * MAP_SIZE;

const state = {
  wave: 0,
  inBuildPhase: true,
  enemiesRemaining: 0,
  selectedBuild: "power",
  resources: { wire: 8, resistor: 5, board: 4 },
  gridObjects: new Map(),
};

const hud = {
  status: document.getElementById("status"),
  materials: document.getElementById("materials"),
};

class CircuitBreakerScene extends Phaser.Scene {
  constructor() {
    super("CircuitBreaker");
  }

  preload() {
    this.load.image("tile", "assets/board_tile.svg");
    this.load.image("player", "assets/player.svg");
    this.load.image("core", "assets/core.svg");
    this.load.image("enemy", "assets/enemy.svg");
    this.load.image("tower", "assets/tower.svg");
    this.load.image("power", "assets/power.svg");
    this.load.image("wire", "assets/wire.svg");
  }

  create() {
    this.drawBoard();

    this.coreCell = { x: Math.floor(MAP_SIZE / 2), y: Math.floor(MAP_SIZE / 2) };
    this.core = this.add.image(
      this.toWorld(this.coreCell.x),
      this.toWorld(this.coreCell.y),
      "core"
    );
    this.core.setDisplaySize(70, 70);
    this.coreHp = 100;

    this.player = this.physics.add.sprite(this.toWorld(1), this.toWorld(1), "player");
    this.player.setDisplaySize(36, 36);
    this.player.setCollideWorldBounds(true);

    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys("W,S,A,D,E,ONE,TWO,THREE,SPACE");

    this.enemies = this.physics.add.group();
    this.projectiles = this.physics.add.group();

    this.physics.add.overlap(this.projectiles, this.enemies, (proj, enemy) => {
      proj.destroy();
      enemy.hp -= 1;
      if (enemy.hp <= 0) {
        enemy.destroy();
        state.enemiesRemaining -= 1;
      }
    });

    this.input.keyboard.on("keydown-ONE", () => (state.selectedBuild = "power"));
    this.input.keyboard.on("keydown-TWO", () => (state.selectedBuild = "wire"));
    this.input.keyboard.on("keydown-THREE", () => (state.selectedBuild = "tower"));
    this.input.keyboard.on("keydown-SPACE", () => {
      if (state.inBuildPhase) {
        this.startWave();
      }
    });

    this.time.addEvent({ delay: 350, callback: this.towerFire, callbackScope: this, loop: true });
    this.time.addEvent({ delay: 1000, callback: this.waveCheck, callbackScope: this, loop: true });

    this.refreshPowerNetwork();
    this.updateHud();
  }

  drawBoard() {
    for (let y = 0; y < MAP_SIZE; y++) {
      for (let x = 0; x < MAP_SIZE; x++) {
        this.add.image(this.toWorld(x), this.toWorld(y), "tile").setDisplaySize(GRID - 2, GRID - 2);
      }
    }
  }

  update() {
    const speed = 180;
    const vx = (this.cursors.left.isDown || this.wasd.A.isDown ? -1 : 0) +
      (this.cursors.right.isDown || this.wasd.D.isDown ? 1 : 0);
    const vy = (this.cursors.up.isDown || this.wasd.W.isDown ? -1 : 0) +
      (this.cursors.down.isDown || this.wasd.S.isDown ? 1 : 0);

    this.player.setVelocity(vx * speed, vy * speed);

    if (Phaser.Input.Keyboard.JustDown(this.wasd.E)) {
      const { gx, gy } = this.playerCell();
      if (state.inBuildPhase) {
        this.placeOrSalvage(gx, gy);
      }
    }

    this.enemies.getChildren().forEach((enemy) => {
      const dir = new Phaser.Math.Vector2(this.core.x - enemy.x, this.core.y - enemy.y).normalize();
      enemy.setVelocity(dir.x * (48 + state.wave * 5), dir.y * (48 + state.wave * 5));
      if (Phaser.Math.Distance.Between(enemy.x, enemy.y, this.core.x, this.core.y) < 25) {
        enemy.destroy();
        this.coreHp -= 8;
        if (this.coreHp <= 0) {
          this.scene.restart();
          Object.assign(state, {
            wave: 0,
            inBuildPhase: true,
            enemiesRemaining: 0,
            selectedBuild: "power",
            resources: { wire: 8, resistor: 5, board: 4 },
            gridObjects: new Map(),
          });
        }
      }
    });

    this.updateHud();
  }

  placeOrSalvage(gx, gy) {
    if (gx === this.coreCell.x && gy === this.coreCell.y) return;

    const key = `${gx},${gy}`;
    const existing = state.gridObjects.get(key);

    if (existing) {
      existing.sprite.destroy();
      state.gridObjects.delete(key);
      state.resources.wire += existing.type === "wire" ? 1 : 0;
      state.resources.resistor += existing.type === "tower" ? 1 : 0;
      state.resources.board += existing.type === "power" ? 1 : 0;
      this.refreshPowerNetwork();
      return;
    }

    const cost = {
      power: { wire: 1, resistor: 0, board: 1, texture: "power" },
      wire: { wire: 1, resistor: 0, board: 0, texture: "wire" },
      tower: { wire: 1, resistor: 1, board: 1, texture: "tower" },
    }[state.selectedBuild];

    if (!cost) return;
    if (state.resources.wire < cost.wire || state.resources.resistor < cost.resistor || state.resources.board < cost.board) {
      return;
    }

    state.resources.wire -= cost.wire;
    state.resources.resistor -= cost.resistor;
    state.resources.board -= cost.board;

    const sprite = this.add.image(this.toWorld(gx), this.toWorld(gy), cost.texture).setDisplaySize(42, 42);
    state.gridObjects.set(key, { type: state.selectedBuild, gx, gy, powered: false, sprite });
    this.refreshPowerNetwork();
  }

  refreshPowerNetwork() {
    state.gridObjects.forEach((obj) => {
      obj.powered = false;
      obj.sprite.clearTint();
    });

    const queue = [];
    state.gridObjects.forEach((obj) => {
      if (obj.type === "power") {
        obj.powered = true;
        queue.push(obj);
      }
    });

    while (queue.length) {
      const now = queue.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const key = `${now.gx + dx},${now.gy + dy}`;
        const next = state.gridObjects.get(key);
        if (!next || next.powered) continue;
        if (next.type === "wire" || next.type === "tower") {
          next.powered = true;
          queue.push(next);
        }
      }
    }

    state.gridObjects.forEach((obj) => {
      if (obj.type === "tower" && !obj.powered) {
        obj.sprite.setTint(0x777777);
      }
      if (obj.type === "wire") {
        obj.sprite.setTint(obj.powered ? 0x8bf9ff : 0x555555);
      }
    });
  }

  towerFire() {
    if (state.inBuildPhase) return;
    const enemies = this.enemies.getChildren();
    if (!enemies.length) return;

    state.gridObjects.forEach((obj) => {
      if (obj.type !== "tower" || !obj.powered) return;
      const towerX = this.toWorld(obj.gx);
      const towerY = this.toWorld(obj.gy);
      const target = enemies
        .map((enemy) => ({ enemy, d: Phaser.Math.Distance.Between(towerX, towerY, enemy.x, enemy.y) }))
        .filter((item) => item.d < 200)
        .sort((a, b) => a.d - b.d)[0]?.enemy;

      if (!target) return;
      const bullet = this.physics.add.image(towerX, towerY, "wire").setDisplaySize(14, 14);
      const dir = new Phaser.Math.Vector2(target.x - towerX, target.y - towerY).normalize();
      bullet.setVelocity(dir.x * 320, dir.y * 320);
      this.projectiles.add(bullet);
      this.time.delayedCall(1200, () => bullet.destroy());
    });
  }

  startWave() {
    state.wave += 1;
    state.inBuildPhase = false;

    const count = 5 + state.wave * 3;
    state.enemiesRemaining = count;

    for (let i = 0; i < count; i++) {
      this.time.delayedCall(i * 380, () => this.spawnEnemy());
    }
  }

  spawnEnemy() {
    const edge = Phaser.Math.Between(0, 3);
    let gx = 0;
    let gy = 0;

    if (edge === 0) {
      gx = 0;
      gy = Phaser.Math.Between(0, MAP_SIZE - 1);
    }
    if (edge === 1) {
      gx = MAP_SIZE - 1;
      gy = Phaser.Math.Between(0, MAP_SIZE - 1);
    }
    if (edge === 2) {
      gx = Phaser.Math.Between(0, MAP_SIZE - 1);
      gy = 0;
    }
    if (edge === 3) {
      gx = Phaser.Math.Between(0, MAP_SIZE - 1);
      gy = MAP_SIZE - 1;
    }

    const enemy = this.physics.add.sprite(this.toWorld(gx), this.toWorld(gy), "enemy");
    enemy.setDisplaySize(32, 32);
    enemy.hp = 2 + Math.floor(state.wave / 2);
    this.enemies.add(enemy);
  }

  waveCheck() {
    if (!state.inBuildPhase && state.enemiesRemaining <= 0 && this.enemies.getChildren().length === 0) {
      state.inBuildPhase = true;
      // 파밍 보상
      state.resources.wire += 2 + state.wave;
      state.resources.resistor += 1 + Math.floor(state.wave / 2);
      state.resources.board += 1;
      this.refreshPowerNetwork();
    }
  }

  updateHud() {
    const mode = state.inBuildPhase ? "크래프팅/배치" : "디펜스 진행";
    hud.status.textContent = `웨이브 ${state.wave} · 상태: ${mode} · 코어 HP ${Math.max(this.coreHp, 0)} · 선택 ${state.selectedBuild}`;
    hud.materials.textContent = `파츠: wire ${state.resources.wire} · resistor ${state.resources.resistor} · board ${state.resources.board}`;
  }

  toWorld(g) {
    return g * GRID + GRID / 2;
  }

  playerCell() {
    return {
      gx: Phaser.Math.Clamp(Math.floor(this.player.x / GRID), 0, MAP_SIZE - 1),
      gy: Phaser.Math.Clamp(Math.floor(this.player.y / GRID), 0, MAP_SIZE - 1),
    };
  }
}

new Phaser.Game({
  type: Phaser.AUTO,
  parent: "game",
  width: WIDTH,
  height: HEIGHT,
  backgroundColor: "#05070f",
  physics: { default: "arcade", arcade: { debug: false } },
  scene: [CircuitBreakerScene],
});
