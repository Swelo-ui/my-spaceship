/**
 * CombatHud — Canvas 2D overlay for combat information:
 * - Player health & shields bars
 * - Ammo counter
 * - Enemy radar markers (screen-edge indicators)
 * - Score & wave display
 * - Hit flash effect
 * - Game over screen
 * - Crosshair with target lock indicator
 */

import React, { useRef, useEffect, MutableRefObject } from 'react';
import { useAppContext } from '../context/AppContext';
import { CombatState } from '../types';

// Must match useCombatSystem constant
const WAVE_SPAWN_INTERVAL = 20.0;

interface CombatHudProps {
    combatStateRef: MutableRefObject<CombatState>;
    onRestart: () => void;
}

// Project world point to screen (same as ProjectileOverlay)
const projectToScreen = (
    worldPos: [number, number, number],
    camPos: [number, number, number],
    camPitch: number,
    camYaw: number,
    w: number,
    h: number,
): { x: number; y: number; inFront: boolean; dist: number } => {
    let dx = worldPos[0] - camPos[0];
    let dy = worldPos[1] - camPos[1];
    let dz = worldPos[2] - camPos[2];

    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    const cosYaw = Math.cos(-camYaw), sinYaw = Math.sin(-camYaw);
    let rx = dx * cosYaw - dz * sinYaw;
    let ry = dy;
    let rz = dx * sinYaw + dz * cosYaw;

    const cosPitch = Math.cos(-camPitch), sinPitch = Math.sin(-camPitch);
    const ry2 = ry * cosPitch - rz * sinPitch;
    const rz2 = ry * sinPitch + rz * cosPitch;
    ry = ry2; rz = rz2;

    const inFront = rz < 0;
    if (!inFront) {
        // Behind camera — flip for edge indicator
        rx = -rx; ry = -ry;
    }

    const focalLen = 1.5;
    const aspect = w / h;
    const screenX = (rx / (Math.abs(rz) || 0.001) * focalLen) / aspect * (w / 2) + w / 2;
    const screenY = (ry / (Math.abs(rz) || 0.001) * focalLen) * (h / 2) + h / 2;

    return { x: screenX, y: screenY, inFront, dist };
};

const drawBar = (
    ctx: CanvasRenderingContext2D,
    x: number, y: number, w: number, h: number,
    value: number, max: number,
    fillColor: string, bgColor: string,
    alpha: number,
) => {
    const ratio = Math.max(0, Math.min(1, value / max));
    ctx.fillStyle = bgColor;
    ctx.globalAlpha = alpha * 0.4;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = fillColor;
    ctx.globalAlpha = alpha;
    ctx.fillRect(x, y, w * ratio, h);
    ctx.globalAlpha = alpha * 0.6;
    ctx.strokeStyle = fillColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
    ctx.globalAlpha = 1;
};

export const CombatHud: React.FC<CombatHudProps> = ({ combatStateRef, onRestart }) => {
    const { cameraRef, isHudEnabled } = useAppContext();
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const restartRef = useRef(onRestart);
    restartRef.current = onRestart;

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        let animId: number;

        const render = (timestamp: number) => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }

            ctx.clearRect(0, 0, w, h);

            if (!isHudEnabled) {
                animId = requestAnimationFrame(render);
                return;
            }

            const cs = combatStateRef.current;
            const cam = cameraRef.current;
            const pitch = cam.rotation[0];
            const yaw = cam.rotation[1];
            const now = timestamp / 1000;

            // ── Hit flash (red screen edge) ──────────────────────────────
            const timeSinceHit = now - cs.lastHitTime;
            if (timeSinceHit < 0.5) {
                const flashAlpha = (1.0 - timeSinceHit / 0.5) * 0.4;
                const grad = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.8);
                grad.addColorStop(0, `rgba(255,0,0,0)`);
                grad.addColorStop(1, `rgba(255,0,0,${flashAlpha})`);
                ctx.fillStyle = grad;
                ctx.fillRect(0, 0, w, h);
            }

            // ── Game Over Screen ─────────────────────────────────────────
            if (cs.isGameOver) {
                ctx.fillStyle = 'rgba(0,0,0,0.7)';
                ctx.fillRect(0, 0, w, h);

                ctx.textAlign = 'center';
                ctx.fillStyle = '#ff3333';
                ctx.font = 'bold 64px monospace';
                ctx.fillText('SHIP DESTROYED', w / 2, h / 2 - 60);

                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 28px monospace';
                ctx.fillText(`SCORE: ${cs.score}`, w / 2, h / 2);
                ctx.fillText(`KILLS: ${cs.killCount}`, w / 2, h / 2 + 40);
                ctx.fillText(`WAVE: ${cs.wave}`, w / 2, h / 2 + 80);

                ctx.fillStyle = '#00ffff';
                ctx.font = 'bold 20px monospace';
                ctx.fillText('Press R to restart', w / 2, h / 2 + 140);

                animId = requestAnimationFrame(render);
                return;
            }

            // ── Crosshair with target lock ───────────────────────────────
            const cx = w / 2, cy = h / 2;
            const activeEnemies = cs.enemies.filter(e => e.state !== 'dead');

            // Check if any enemy is near crosshair
            let targetLocked = false;
            let closestEnemyDist = Infinity;
            for (const enemy of activeEnemies) {
                const proj = projectToScreen(enemy.position, cam.position, pitch, yaw, w, h);
                if (proj.inFront) {
                    const screenDist = Math.sqrt((proj.x - cx) ** 2 + (proj.y - cy) ** 2);
                    if (screenDist < 60) {
                        targetLocked = true;
                    }
                    if (proj.dist < closestEnemyDist) closestEnemyDist = proj.dist;
                }
            }

            // Draw crosshair
            const crossColor = targetLocked ? '#ff4444' : 'rgba(255,255,255,0.7)';
            ctx.strokeStyle = crossColor;
            ctx.lineWidth = targetLocked ? 2 : 1.5;
            ctx.shadowColor = targetLocked ? '#ff0000' : 'transparent';
            ctx.shadowBlur = targetLocked ? 6 : 0;

            const crossSize = targetLocked ? 14 : 10;
            const crossGap = targetLocked ? 6 : 4;

            ctx.beginPath();
            ctx.moveTo(cx - crossSize - crossGap, cy); ctx.lineTo(cx - crossGap, cy);
            ctx.moveTo(cx + crossGap, cy); ctx.lineTo(cx + crossSize + crossGap, cy);
            ctx.moveTo(cx, cy - crossSize - crossGap); ctx.lineTo(cx, cy - crossGap);
            ctx.moveTo(cx, cy + crossGap); ctx.lineTo(cx, cy + crossSize + crossGap);
            ctx.stroke();

            // Target lock brackets
            if (targetLocked) {
                const bSize = 20;
                ctx.beginPath();
                ctx.moveTo(cx - bSize, cy - bSize + 6); ctx.lineTo(cx - bSize, cy - bSize); ctx.lineTo(cx - bSize + 6, cy - bSize);
                ctx.moveTo(cx + bSize - 6, cy - bSize); ctx.lineTo(cx + bSize, cy - bSize); ctx.lineTo(cx + bSize, cy - bSize + 6);
                ctx.moveTo(cx - bSize, cy + bSize - 6); ctx.lineTo(cx - bSize, cy + bSize); ctx.lineTo(cx - bSize + 6, cy + bSize);
                ctx.moveTo(cx + bSize - 6, cy + bSize); ctx.lineTo(cx + bSize, cy + bSize); ctx.lineTo(cx + bSize, cy + bSize - 6);
                ctx.stroke();
            }

            ctx.shadowBlur = 0;

            // ── Enemy markers (on-screen diamonds + off-screen arrows) ───
            for (const enemy of activeEnemies) {
                if (enemy.state === 'dying') continue;
                const proj = projectToScreen(enemy.position, cam.position, pitch, yaw, w, h);
                const margin = 30;

                if (proj.inFront && proj.x > margin && proj.x < w - margin &&
                    proj.y > margin && proj.y < h - margin) {
                    // On-screen: draw diamond marker above enemy
                    const markerX = proj.x;
                    const markerY = proj.y - 30;
                    const size = Math.max(4, 12 - proj.dist * 0.8);

                    // Health bar above marker
                    const barW = size * 4;
                    const healthRatio = enemy.health / enemy.maxHealth;
                    const barColor = healthRatio > 0.5 ? '#ff4444' : '#ff8800';
                    drawBar(ctx, markerX - barW / 2, markerY - size - 8, barW, 3,
                        enemy.health, enemy.maxHealth, barColor, '#330000', 0.8);

                    // Shield bar
                    if (enemy.maxShields > 0) {
                        drawBar(ctx, markerX - barW / 2, markerY - size - 14, barW, 3,
                            enemy.shields, enemy.maxShields, '#00aaff', '#001133', 0.8);
                    }

                    // Diamond
                    ctx.strokeStyle = '#ff4444';
                    ctx.lineWidth = 1.5;
                    ctx.shadowColor = '#ff0000';
                    ctx.shadowBlur = 4;
                    ctx.beginPath();
                    ctx.moveTo(markerX, markerY - size);
                    ctx.lineTo(markerX + size, markerY);
                    ctx.lineTo(markerX, markerY + size);
                    ctx.lineTo(markerX - size, markerY);
                    ctx.closePath();
                    ctx.stroke();
                    ctx.shadowBlur = 0;

                    // Distance text
                    ctx.fillStyle = 'rgba(255,100,100,0.8)';
                    ctx.font = '10px monospace';
                    ctx.textAlign = 'center';
                    ctx.fillText(`${proj.dist.toFixed(1)}`, markerX, markerY + size + 12);
                } else {
                    // Off-screen: draw arrow at screen edge
                    const edgeX = Math.max(margin, Math.min(w - margin, proj.x));
                    const edgeY = Math.max(margin, Math.min(h - margin, proj.y));

                    // Clamp to edge
                    const angle = Math.atan2(proj.y - cy, proj.x - cx);
                    const edgeDist = Math.min(
                        Math.abs((proj.x > cx ? w - margin - cx : cx - margin) / Math.cos(angle)),
                        Math.abs((proj.y > cy ? h - margin - cy : cy - margin) / Math.sin(angle))
                    );
                    const arrowX = cx + Math.cos(angle) * edgeDist;
                    const arrowY = cy + Math.sin(angle) * edgeDist;

                    ctx.save();
                    ctx.translate(arrowX, arrowY);
                    ctx.rotate(angle + Math.PI / 2);
                    ctx.strokeStyle = 'rgba(255,80,80,0.7)';
                    ctx.lineWidth = 1.5;
                    ctx.beginPath();
                    ctx.moveTo(0, -8); ctx.lineTo(5, 4); ctx.lineTo(-5, 4); ctx.closePath();
                    ctx.stroke();
                    ctx.restore();
                }
            }

            // ── Bottom-left: Health & Shields ────────────────────────────
            const panelX = 20;
            const panelY = h - 90;
            const barWidth = 180;
            const barHeight = 12;

            ctx.font = 'bold 11px monospace';
            ctx.textAlign = 'left';

            // Shields
            ctx.fillStyle = 'rgba(0,150,255,0.9)';
            ctx.fillText('SHIELDS', panelX, panelY - 2);
            drawBar(ctx, panelX, panelY, barWidth, barHeight,
                cs.playerShields, cs.playerMaxShields, '#0088ff', '#001133', 0.9);

            // Health
            const healthColor = cs.playerHealth > 50 ? '#00ff88' : cs.playerHealth > 25 ? '#ffaa00' : '#ff3333';
            ctx.fillStyle = healthColor;
            ctx.fillText('HULL', panelX, panelY + barHeight + 16);
            drawBar(ctx, panelX, panelY + barHeight + 18, barWidth, barHeight,
                cs.playerHealth, cs.playerMaxHealth, healthColor, '#1a0000', 0.9);

            // ── Bottom-right: Ammo ───────────────────────────────────────
            const ammoX = w - 160;
            const ammoY = h - 90;

            ctx.textAlign = 'right';
            ctx.fillStyle = 'rgba(255,220,100,0.9)';
            ctx.font = 'bold 11px monospace';
            ctx.fillText('LASER AMMO', w - 20, ammoY - 2);

            // Ammo pips
            const pipW = 8, pipH = 14, pipGap = 3;
            const totalPips = cs.maxAmmo;
            const filledPips = cs.ammo;
            for (let i = 0; i < totalPips; i++) {
                const px = w - 20 - (totalPips - i) * (pipW + pipGap);
                const filled = i < filledPips;
                ctx.fillStyle = filled ? 'rgba(255,220,50,0.9)' : 'rgba(80,60,20,0.5)';
                ctx.fillRect(px, ammoY, pipW, pipH);
                ctx.strokeStyle = filled ? 'rgba(255,200,0,0.6)' : 'rgba(60,50,20,0.3)';
                ctx.lineWidth = 0.5;
                ctx.strokeRect(px, ammoY, pipW, pipH);
            }

            // ── Top-center: Score & Wave ─────────────────────────────────
            ctx.textAlign = 'center';
            ctx.font = 'bold 13px monospace';
            ctx.fillStyle = 'rgba(255,255,255,0.7)';
            ctx.fillText(`SCORE: ${cs.score}`, w / 2, 24);

            ctx.font = 'bold 11px monospace';
            ctx.fillStyle = 'rgba(200,200,200,0.6)';
            ctx.fillText(`WAVE ${cs.wave} | KILLS: ${cs.killCount}`, w / 2, 42);

            // Enemy count
            const aliveCount = activeEnemies.length;
            if (aliveCount > 0) {
                ctx.fillStyle = 'rgba(255,100,100,0.8)';
                ctx.fillText(`ENEMIES: ${aliveCount}`, w / 2, 60);
            } else if (cs.waveTimer < WAVE_SPAWN_INTERVAL) {
                const timeLeft = Math.ceil(cs.waveTimer);
                ctx.fillStyle = 'rgba(255,200,50,0.8)';
                ctx.fillText(`NEXT WAVE IN: ${timeLeft}s`, w / 2, 60);
            }

            // ── Fire key hint (bottom center) ────────────────────────────
            ctx.textAlign = 'center';
            ctx.font = '10px monospace';
            ctx.fillStyle = 'rgba(150,150,150,0.5)';
            ctx.fillText('[F] FIRE', w / 2, h - 20);

            animId = requestAnimationFrame(render);
        };

        // Listen for restart key
        const handleKey = (e: KeyboardEvent) => {
            if (e.key.toLowerCase() === 'r' && combatStateRef.current.isGameOver) {
                restartRef.current();
            }
        };
        window.addEventListener('keydown', handleKey);

        animId = requestAnimationFrame(render);
        return () => {
            cancelAnimationFrame(animId);
            window.removeEventListener('keydown', handleKey);
        };
    }, [combatStateRef, cameraRef, isHudEnabled]);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 pointer-events-none"
            style={{ zIndex: 25 }}
        />
    );
};
