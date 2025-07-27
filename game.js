const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ゲーム状態
let player, enemies, bullets, expOrbs, particles, keys, gameRunning, gamePaused, lastTime, elapsedTime;
let highScore = localStorage.getItem('vampireSurvivorsHighScore') || 0;
let currentWave;
let waveTimer;
let animationId = null;
let lastMoveDirection = { x: 0, y: -1 }; // 初期は上向き

// ゲーム定数
const playerSpeed = 3;
const baseEnemySpeed = 1.5;
const bulletSpeed = 4;
const orbAttractionSpeed = 10.0;

// 敵タイプの定義
const enemyTypes = {
    normal: { hp: 3, speed: 1, size: 10, color: 'red', exp: 1 },
    fast: { hp: 2, speed: 2, size: 8, color: 'orange', exp: 2 },
    tank: { hp: 8, speed: 0.5, size: 15, color: 'darkred', exp: 3 },
    shooter: { hp: 4, speed: 0.8, size: 12, color: 'purple', exp: 2, shootInterval: 2000 }
};

// 武器クラス
class Weapon {
    constructor(type, interval) {
        this.type = type;
        this.interval = interval;
        this.shootCooldown = 0;
        this.level = 1;
    }

    upgrade() {
        this.level++;
        this.interval = Math.max(50, this.interval - 30);
    }

    shoot(player, bullets) {
        switch(this.type) {
            case 'EightWayShot':
                for (let i = 0; i < 8; i++) {
                    let angle = (Math.PI * 2 / 8) * i;
                    bullets.push({
                        x: player.x,
                        y: player.y,
                        size: 5,
                        angle: angle,
                        damage: 1 + Math.floor(this.level / 3),
                        piercing: this.level >= 5 ? 1 : 0,
                        type: 'normal'
                    });
                }
                break;
            case 'FrontalShot':
                // プレイヤーの向いている方向に発射
                let baseAngle = Math.atan2(lastMoveDirection.y, lastMoveDirection.x);
                for (let i = -1; i <= 1; i++) {
                    let angle = baseAngle + (i * 0.1);
                    bullets.push({
                        x: player.x,
                        y: player.y,
                        size: 5,
                        angle: angle,
                        damage: 2 + Math.floor(this.level / 2),
                        piercing: 0,
                        type: 'normal'
                    });
                }
                break;
            case 'PiercingShot':
                let angle = Math.atan2(0, -1);
                bullets.push({
                    x: player.x,
                    y: player.y,
                    size: 8,
                    angle: angle,
                    damage: 3 + this.level,
                    piercing: 3 + Math.floor(this.level / 2),
                    type: 'piercing'
                });
                break;
            case 'AreaBlast':
                bullets.push({
                    x: player.x,
                    y: player.y,
                    size: 20 + this.level * 5,
                    angle: 0,
                    damage: 2 + this.level,
                    piercing: 999,
                    type: 'area',
                    lifetime: 200
                });
                break;
        }
    }
}

// パーティクル作成
function createParticle(x, y, color, size = 3) {
    particles.push({
        x: x,
        y: y,
        vx: (Math.random() - 0.5) * 4,
        vy: (Math.random() - 0.5) * 4,
        size: size,
        color: color,
        lifetime: 30
    });
}

// 画面揺れエフェクト
function shakeScreen() {
    canvas.classList.add('shake');
    setTimeout(() => canvas.classList.remove('shake'), 200);
}

// ゲーム開始
function startGame() {
    // 既存のアニメーションをキャンセル
    if (animationId) {
        cancelAnimationFrame(animationId);
        animationId = null;
    }
    
    player = {
        x: 400,
        y: 300,
        size: 10,
        exp: 0,
        level: 1,
        expToLevelUp: 5,
        weapons: [],
        moveSpeedBonus: 0,
        expRangeBonus: 0
    };
    
    enemies = [];
    bullets = [];
    expOrbs = [];
    particles = [];
    keys = {};
    gameRunning = true;
    gamePaused = false;
    lastTime = 0;
    elapsedTime = 0;
    currentWave = 1;
    waveTimer = 0;

    document.getElementById('startButton').style.display = 'none';
    document.getElementById('retryButton').style.display = 'none';
    document.getElementById('gameOverScreen').style.display = 'none';
    document.getElementById('status').innerText = '';
    updateHighScore();

    // 初期武器
    player.weapons.push(new Weapon('EightWayShot', 300));
    
    // 初期ステータス表示
    document.getElementById('status').innerText = 
        `Time: 0s | Wave: 1 | Level: 1 | EXP: 0/${player.expToLevelUp}`;

    window.addEventListener('keydown', handleGameStartRetry);
    animationId = requestAnimationFrame(gameLoop);
}

// ウェーブ管理
function updateWaveSystem(delta) {
    waveTimer += delta;
    
    // 30秒ごとに新しいウェーブ
    if (waveTimer > 30000) {
        currentWave++;
        waveTimer = 0;
        
        // ウェーブボーナスの経験値オーブ
        for (let i = 0; i < 5 + currentWave; i++) {
            expOrbs.push({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                size: 8,
                value: currentWave
            });
        }
    }
}

// 敵のスポーン
function spawnEnemies() {
    // 時間経過とウェーブに応じてスポーン率を増加
    let spawnChance = 0.02 + (elapsedTime / 1000) * 0.001 + (currentWave - 1) * 0.005;
    
    if (Math.random() < spawnChance) {
        let edge = Math.floor(Math.random() * 4);
        let ex, ey;
        
        if (edge === 0) { ex = Math.random() * canvas.width; ey = -20; }
        else if (edge === 1) { ex = Math.random() * canvas.width; ey = canvas.height + 20; }
        else if (edge === 2) { ex = -20; ey = Math.random() * canvas.height; }
        else { ex = canvas.width + 20; ey = Math.random() * canvas.height; }
        
        // 敵タイプの選択（ウェーブが進むほど強い敵が出現）
        let enemyTypeRoll = Math.random();
        let selectedType = 'normal';
        
        if (currentWave >= 2 && enemyTypeRoll < 0.3) selectedType = 'fast';
        if (currentWave >= 3 && enemyTypeRoll < 0.2) selectedType = 'tank';
        if (currentWave >= 4 && enemyTypeRoll < 0.1) selectedType = 'shooter';
        
        let enemyData = enemyTypes[selectedType];
        enemies.push({
            x: ex,
            y: ey,
            size: enemyData.size,
            hp: enemyData.hp,
            maxHp: enemyData.hp,
            speed: enemyData.speed * baseEnemySpeed,
            color: enemyData.color,
            exp: enemyData.exp,
            type: selectedType,
            shootCooldown: selectedType === 'shooter' ? enemyData.shootInterval : 0
        });
    }
}

// アップグレード画面
function showUpgradeScreen() {
    gamePaused = true;
    document.getElementById('upgradeScreen').style.display = 'block';
    const upgradeOptionsDiv = document.getElementById('upgradeOptions');
    upgradeOptionsDiv.innerHTML = '';

    const availableUpgrades = [];
    
    // 既存武器のアップグレード
    player.weapons.forEach(weapon => {
        availableUpgrades.push({
            name: `${weapon.type} レベルアップ`,
            description: `攻撃間隔を短縮し、ダメージを増加`,
            apply: () => weapon.upgrade()
        });
    });
    
    // 新武器の追加
    if (!player.weapons.find(w => w.type === 'FrontalShot')) {
        availableUpgrades.push({
            name: '新武器: 前方ショット',
            description: '前方に3発の高威力弾を発射',
            apply: () => player.weapons.push(new Weapon('FrontalShot', 200))
        });
    }
    
    if (!player.weapons.find(w => w.type === 'PiercingShot') && player.level >= 5) {
        availableUpgrades.push({
            name: '新武器: 貫通弾',
            description: '敵を貫通する強力な弾を発射',
            apply: () => player.weapons.push(new Weapon('PiercingShot', 500))
        });
    }
    
    if (!player.weapons.find(w => w.type === 'AreaBlast') && player.level >= 8) {
        availableUpgrades.push({
            name: '新武器: 範囲爆発',
            description: '周囲の敵にダメージを与える爆発を起こす',
            apply: () => player.weapons.push(new Weapon('AreaBlast', 800))
        });
    }
    
    // パッシブアビリティ
    availableUpgrades.push({
        name: '移動速度アップ',
        description: '移動速度を10%上昇',
        apply: () => player.moveSpeedBonus += 0.1
    });
    
    availableUpgrades.push({
        name: '経験値取得範囲アップ',
        description: '経験値オーブの引き寄せ範囲を拡大',
        apply: () => player.expRangeBonus += 20
    });

    // ランダムに3つ選択
    const selectedUpgrades = [];
    while (selectedUpgrades.length < 3 && availableUpgrades.length > 0) {
        const index = Math.floor(Math.random() * availableUpgrades.length);
        selectedUpgrades.push(availableUpgrades.splice(index, 1)[0]);
    }

    selectedUpgrades.forEach((upgrade, index) => {
        const button = document.createElement('button');
        button.innerHTML = `<strong>${index + 1}. ${upgrade.name}</strong><br>${upgrade.description}`;
        button.onclick = () => {
            upgrade.apply();
            hideUpgradeScreen();
        };
        upgradeOptionsDiv.appendChild(button);
    });

    window.addEventListener('keydown', handleUpgradeSelection);
}

function handleUpgradeSelection(e) {
    if (!gamePaused) return;

    const upgradeOptionsDiv = document.getElementById('upgradeOptions');
    const buttons = upgradeOptionsDiv.getElementsByTagName('button');
    const selectedIndex = parseInt(e.key) - 1;

    if (selectedIndex >= 0 && selectedIndex < buttons.length) {
        buttons[selectedIndex].click();
        window.removeEventListener('keydown', handleUpgradeSelection);
    }
}

function hideUpgradeScreen() {
    document.getElementById('upgradeScreen').style.display = 'none';
    gamePaused = false;
    window.removeEventListener('keydown', handleUpgradeSelection);
    animationId = requestAnimationFrame(gameLoop);
}

// ゲームループ
function gameLoop(timestamp) {
    if (!gameRunning || gamePaused) return;

    let delta = timestamp - lastTime;
    // 初回フレームや長時間の停止後は、deltaを制限
    if (lastTime === 0 || delta > 1000) {
        delta = 16; // 約60FPSの1フレーム
    }
    lastTime = timestamp;
    elapsedTime += delta / 1000;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // ウェーブシステム更新
    updateWaveSystem(delta);

    // プレイヤー移動
    const currentSpeed = playerSpeed * (1 + player.moveSpeedBonus);
    let moveX = 0, moveY = 0;
    
    if (keys['ArrowUp']) {
        player.y -= currentSpeed;
        moveY = -1;
    }
    if (keys['ArrowDown']) {
        player.y += currentSpeed;
        moveY = 1;
    }
    if (keys['ArrowLeft']) {
        player.x -= currentSpeed;
        moveX = -1;
    }
    if (keys['ArrowRight']) {
        player.x += currentSpeed;
        moveX = 1;
    }
    
    // 移動方向を記録（移動している場合のみ）
    if (moveX !== 0 || moveY !== 0) {
        const length = Math.sqrt(moveX * moveX + moveY * moveY);
        lastMoveDirection.x = moveX / length;
        lastMoveDirection.y = moveY / length;
    }

    player.x = Math.max(0, Math.min(canvas.width, player.x));
    player.y = Math.max(0, Math.min(canvas.height, player.y));

    // 武器発射
    player.weapons.forEach(weapon => {
        weapon.shootCooldown -= delta;
        if (weapon.shootCooldown <= 0) {
            weapon.shoot(player, bullets);
            weapon.shootCooldown = weapon.interval;
        }
    });

    // 弾の更新
    bullets.forEach(b => {
        if (b.type === 'area') {
            b.lifetime -= delta;
        } else {
            b.x += bulletSpeed * Math.cos(b.angle);
            b.y += bulletSpeed * Math.sin(b.angle);
        }
    });

    bullets = bullets.filter(b => {
        if (b.type === 'area') return b.lifetime > 0;
        return !b.hit && b.x > -50 && b.x < canvas.width + 50 && b.y > -50 && b.y < canvas.height + 50;
    });

    // 敵のスポーン
    spawnEnemies();

    // 敵の更新
    enemies.forEach(e => {
        let dx = player.x - e.x;
        let dy = player.y - e.y;
        let dist = Math.hypot(dx, dy);
        
        if (dist > 0) {
            e.x += (dx / dist) * e.speed;
            e.y += (dy / dist) * e.speed;
        }

        // シューター敵の攻撃
        if (e.type === 'shooter') {
            e.shootCooldown -= delta;
            if (e.shootCooldown <= 0 && dist < 200) {
                bullets.push({
                    x: e.x,
                    y: e.y,
                    size: 4,
                    angle: Math.atan2(dy, dx),
                    damage: 1,
                    piercing: 0,
                    type: 'enemy',
                    hostile: true
                });
                e.shootCooldown = enemyTypes.shooter.shootInterval;
            }
        }
    });

    // 衝突判定
    bullets.forEach(b => {
        if (b.hostile) {
            // 敵の弾とプレイヤーの衝突
            if (Math.hypot(player.x - b.x, player.y - b.y) < player.size + b.size) {
                endGame();
            }
        } else {
            // プレイヤーの弾と敵の衝突
            enemies.forEach(e => {
                if (b.type === 'area') {
                    if (Math.hypot(e.x - b.x, e.y - b.y) < e.size + b.size) {
                        e.hp -= b.damage;
                        createParticle(e.x, e.y, e.color);
                    }
                } else if (Math.hypot(e.x - b.x, e.y - b.y) < e.size + b.size) {
                    e.hp -= b.damage;
                    createParticle(b.x, b.y, 'yellow');
                    
                    if (b.piercing > 0) {
                        b.piercing--;
                    } else {
                        b.hit = true;
                    }
                }
            });
        }
    });

    // 敵の削除と経験値ドロップ
    enemies = enemies.filter(e => {
        if (e.hp <= 0) {
            for (let i = 0; i < 5; i++) {
                createParticle(e.x, e.y, e.color, 5);
            }
            expOrbs.push({ x: e.x, y: e.y, size: 5, value: e.exp });
            if (e.type === 'tank') shakeScreen();
            return false;
        }
        if (Math.hypot(e.x - player.x, e.y - player.y) < e.size + player.size) {
            endGame();
            return false;
        }
        return true;
    });

    // 経験値オーブの更新
    const attractionRange = 50 + player.expRangeBonus;
    expOrbs.forEach(o => {
        let dx = player.x - o.x;
        let dy = player.y - o.y;
        let dist = Math.hypot(dx, dy);
        
        if (dist < attractionRange) {
            o.x += (dx / dist) * orbAttractionSpeed;
            o.y += (dy / dist) * orbAttractionSpeed;
        }
        
        if (dist < 15) {
            player.exp += o.value || 1;
            o.collected = true;
            createParticle(o.x, o.y, 'cyan', 3);
        }
    });

    expOrbs = expOrbs.filter(o => !o.collected);

    // レベルアップ
    if (player.exp >= player.expToLevelUp) {
        player.level++;
        player.exp = 0;
        player.expToLevelUp += 5;
        showUpgradeScreen();
    }

    // パーティクル更新
    particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.2;
        p.lifetime--;
    });
    particles = particles.filter(p => p.lifetime > 0);

    // 描画
    drawGame();

    // UI更新
    document.getElementById('status').innerText = 
        `Time: ${Math.floor(elapsedTime)}s | Wave: ${currentWave} | Level: ${player.level} | EXP: ${player.exp}/${player.expToLevelUp}`;

    animationId = requestAnimationFrame(gameLoop);
}

// 描画処理
function drawGame() {
    // プレイヤー
    ctx.fillStyle = 'lime';
    ctx.beginPath();
    ctx.arc(player.x, player.y, player.size, 0, Math.PI * 2);
    ctx.fill();

    // 弾
    bullets.forEach(b => {
        ctx.fillStyle = b.hostile ? 'magenta' : b.type === 'area' ? 'rgba(255, 255, 0, 0.3)' : 'yellow';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
        ctx.fill();
    });

    // 敵
    enemies.forEach(e => {
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
        ctx.fill();

        // HPバー
        ctx.fillStyle = 'white';
        ctx.fillRect(e.x - 15, e.y - e.size - 10, 30, 3);
        ctx.fillStyle = 'green';
        ctx.fillRect(e.x - 15, e.y - e.size - 10, (30 * e.hp) / e.maxHp, 3);
    });

    // 経験値オーブ
    ctx.fillStyle = 'cyan';
    expOrbs.forEach(o => {
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.size, 0, Math.PI * 2);
        ctx.fill();
    });

    // パーティクル
    particles.forEach(p => {
        ctx.fillStyle = p.color;
        ctx.globalAlpha = p.lifetime / 30;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    });
    ctx.globalAlpha = 1;
}

// ゲーム終了
function endGame() {
    gameRunning = false;
    
    // 最終的なステータスを保存
    const finalTime = Math.floor(elapsedTime);
    const finalWave = currentWave;
    const finalLevel = player.level;
    
    // プレイヤー破壊エフェクト
    for (let i = 0; i < 30; i++) {
        particles.push({
            x: player.x,
            y: player.y,
            vx: (Math.random() - 0.5) * 15,
            vy: (Math.random() - 0.5) * 15,
            size: Math.random() * 8 + 3,
            color: 'lime',
            lifetime: 60
        });
    }
    
    // 衝撃波エフェクト
    for (let i = 0; i < 3; i++) {
        setTimeout(() => {
            for (let j = 0; j < 20; j++) {
                const angle = (Math.PI * 2 / 20) * j;
                particles.push({
                    x: player.x,
                    y: player.y,
                    vx: Math.cos(angle) * (8 - i * 2),
                    vy: Math.sin(angle) * (8 - i * 2),
                    size: 5,
                    color: ['white', 'yellow', 'orange'][i],
                    lifetime: 40
                });
            }
            shakeScreen();
        }, i * 100);
    }
    
    // プレイヤーを見えなくする
    player.size = 0;
    
    // 少し遅れてゲームオーバー表示
    setTimeout(() => {
        // ハイスコア更新
        if (finalTime > highScore) {
            highScore = finalTime;
            localStorage.setItem('vampireSurvivorsHighScore', highScore);
            updateHighScore();
        }
        
        // ゲームオーバー画面表示
        document.getElementById('gameOverScreen').style.display = 'block';
        document.getElementById('finalScore').innerHTML = `
            <div>生存時間: ${finalTime}秒</div>
            <div>到達ウェーブ: ${finalWave}</div>
            <div>最終レベル: ${finalLevel}</div>
        `;
        
        document.getElementById('retryButton').style.display = 'block';
        document.getElementById('retryButton').style.opacity = '1';
        window.addEventListener('keydown', handleGameStartRetry);
    }, 500);
    
    // 死亡後もパーティクルを描画するため
    let deathAnimationTime = 0;
    function deathAnimation(timestamp) {
        if (deathAnimationTime < 2000) {
            deathAnimationTime += 16;
            
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            
            // パーティクル更新
            particles.forEach(p => {
                p.x += p.vx;
                p.y += p.vy;
                p.vy += 0.3;
                p.vx *= 0.98;
                p.lifetime--;
            });
            particles = particles.filter(p => p.lifetime > 0);
            
            // 敵と弾も描画
            enemies.forEach(e => {
                ctx.fillStyle = e.color;
                ctx.beginPath();
                ctx.arc(e.x, e.y, e.size, 0, Math.PI * 2);
                ctx.fill();
            });
            
            bullets.forEach(b => {
                ctx.fillStyle = b.hostile ? 'magenta' : 'yellow';
                ctx.beginPath();
                ctx.arc(b.x, b.y, b.size, 0, Math.PI * 2);
                ctx.fill();
            });
            
            // パーティクル描画
            particles.forEach(p => {
                ctx.fillStyle = p.color;
                ctx.globalAlpha = p.lifetime / 60;
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.globalAlpha = 1;
            
            requestAnimationFrame(deathAnimation);
        }
    }
    requestAnimationFrame(deathAnimation);
}

// ハイスコア表示更新
function updateHighScore() {
    document.getElementById('highScore').innerText = `High Score: ${highScore}s`;
}

// キーボード処理
function handleGameStartRetry(e) {
    if (e.key === 'Enter') {
        if (!gameRunning && document.getElementById('startButton').style.display === 'block') {
            startGame();
        } else if (!gameRunning && document.getElementById('retryButton').style.display === 'block') {
            startGame();
        }
    }
}

window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);

document.getElementById('startButton').addEventListener('click', startGame);
document.getElementById('retryButton').addEventListener('click', startGame);

// 初期化
window.addEventListener('keydown', handleGameStartRetry);
updateHighScore();

// スタートボタンを表示状態にする
document.getElementById('startButton').style.display = 'block';
document.getElementById('startButton').style.opacity = '1';