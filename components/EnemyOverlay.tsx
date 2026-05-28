/**
 * EnemyOverlay — renders enemy ships as 2D projected shapes on Canvas 2D.
 * Projects 3D world positions to screen space and draws stylized ship silhouettes.
 * This avoids the WebGL blue-screen issue from fullscreen quad clearing.
 */

import React, { useRef, useEffect, MutableRefObject } from 'react';
import { useAppContext } from '../context/AppContext';
import { CombatState, Enemy } from '../types';

interface EnemyOverlayProps {
    combatStateRef: MutableRefObject<CombatState>;
}

// Project a 3D world point to 2D screen coords
// Returns null if behind camera
function worldToScreen(
    wx: number, wy: number, wz: number,
    camPx: number, camPy: number, camPz: number,
    camPitch: number, camYaw: number, camRoll: number,
    screenW: number, screenH: number
): { x: number; y: number; depth: number } | null {
    // Translate
    let dx = wx - camPx;
    let dy = wy - camPy;
    let dz = wz - camPz;

    // Inverse yaw
    const cosY = Math.cos(-camYaw), sinY = Math.sin(-camYaw);
    let rx = dx * cosY - dz * sinY;
    let ry = dy;
    let rz = dx * sinY + dz * cosY;

    // Inverse pitch
    const cosP = Math.cos(-camPitch), sinP = Math.sin(-camPitch);
    const ry2 = ry * cosP - rz * sinP;
    const rz2 = ry * sinP + rz * cosP;
    ry = ry2; rz = rz2;

    // Inverse roll
    const cosR = Math.cos(-camRoll), sinR = Math.sin(-camRoll);
    const rx2 = rx * cosR - ry * sinR;
    const ry3 = rx * sinR + ry * cosR;
    rx = rx2; ry = ry3;

    if (rz >= -0.1) return null; // behind camera

    const fov = 1.5;
    const aspect = screenW / screenH;
    const sx = (rx / (-rz) * fov / aspect) * (screenW / 2) + screenW / 2;
    const sy = -(ry / (-rz) * fov) * (screenH / 2) + screenH / 2;

    return { x: sx, y: sy, depth: -rz };
}

// Draw a stylized enemy ship silhouette at screen position
function drawEnemyShip(
    ctx: CanvasRenderingContext2D,
    sx: number, sy: number,
    size: number,
    variant: number,
    hitFlash: number,
    deathTimer: number,
    shields: number,
    maxShields: number,
    health: number,
    maxHealth: number,
    yaw: number,  // enemy facing direction for rotation
    camYaw: number
) {
    const deathProgress = deathTimer / 1.5;
    const alpha = deathTimer > 0 ? Math.max(0, 1 - deathProgress * deathProgress) : 1.0;
    if (alpha <= 0) return;

    ctx.save();
    ctx.translate(sx, sy);

    // Rotate ship to face direction relative to camera
    const facingAngle = yaw - camYaw;
    ctx.rotate(facingAngle);

    // Scale based on death explosion
    const scale = deathTimer > 0 ? 1 + deathProgress * 2 : 1;
    ctx.scale(scale, scale);

    ctx.globalAlpha = alpha;

    // Colors per variant
    let bodyColor: string, glowColor: string, engineColor: string;
    if (variant === 0) {
        bodyColor = '#cc2222';   // Red scout
        glowColor = '#ff4444';
        engineColor = '#ff6600';
    } else if (variant === 1) {
        bodyColor = '#882299';   // Purple fighter
        glowColor = '#cc44ff';
        engineColor = '#ff44aa';
    } else {
        bodyColor = '#226622';   // Green heavy
        glowColor = '#44ff44';
        engineColor = '#88ff00';
    }

    // Hit flash override
    if (hitFlash > 0) {
        bodyColor = `rgba(255,255,255,${hitFlash})`;
        glowColor = '#ffffff';
    }

    // Death color
    if (deathTimer > 0) {
        bodyColor = `rgba(255,${Math.floor(150 * (1 - deathProgress))},0,${alpha})`;
        glowColor = '#ffaa00';
    }

    const s = size;

    // Glow shadow
    ctx.shadowColor = glowColor;
    ctx.shadowBlur = 12 + hitFlash * 20;

    // Draw ship body based on variant
    ctx.fillStyle = bodyColor;
    ctx.strokeStyle = glowColor;
    ctx.lineWidth = 1.5;

    if (variant === 0) {
        // Scout: sleek triangle
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.2);
        ctx.lineTo(s * 0.7, s * 0.8);
        ctx.lineTo(s * 0.2, s * 0.4);
        ctx.lineTo(0, s * 0.6);
        ctx.lineTo(-s * 0.2, s * 0.4);
        ctx.lineTo(-s * 0.7, s * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Wing details
        ctx.beginPath();
        ctx.moveTo(s * 0.3, 0); ctx.lineTo(s * 0.9, s * 0.5);
        ctx.moveTo(-s * 0.3, 0); ctx.lineTo(-s * 0.9, s * 0.5);
        ctx.stroke();

    } else if (variant === 1) {
        // Fighter: X-wing style
        ctx.beginPath();
        ctx.moveTo(0, -s * 1.0);
        ctx.lineTo(s * 0.3, -s * 0.2);
        ctx.lineTo(s * 1.1, -s * 0.6);
        ctx.lineTo(s * 0.8, s * 0.2);
        ctx.lineTo(s * 0.3, s * 0.5);
        ctx.lineTo(s * 1.0, s * 0.9);
        ctx.lineTo(0, s * 0.7);
        ctx.lineTo(-s * 1.0, s * 0.9);
        ctx.lineTo(-s * 0.3, s * 0.5);
        ctx.lineTo(-s * 0.8, s * 0.2);
        ctx.lineTo(-s * 1.1, -s * 0.6);
        ctx.lineTo(-s * 0.3, -s * 0.2);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

    } else {
        // Heavy: wide dreadnought
        ctx.beginPath();
        ctx.moveTo(0, -s * 0.8);
        ctx.lineTo(s * 0.4, -s * 0.4);
        ctx.lineTo(s * 1.3, -s * 0.2);
        ctx.lineTo(s * 1.4, s * 0.4);
        ctx.lineTo(s * 0.8, s * 0.8);
        ctx.lineTo(s * 0.3, s * 0.6);
        ctx.lineTo(0, s * 0.9);
        ctx.lineTo(-s * 0.3, s * 0.6);
        ctx.lineTo(-s * 0.8, s * 0.8);
        ctx.lineTo(-s * 1.4, s * 0.4);
        ctx.lineTo(-s * 1.3, -s * 0.2);
        ctx.lineTo(-s * 0.4, -s * 0.4);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();

        // Cannon barrels
        ctx.strokeStyle = glowColor;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(s * 0.5, -s * 0.6); ctx.lineTo(s * 0.5, -s * 1.3);
        ctx.moveTo(-s * 0.5, -s * 0.6); ctx.lineTo(-s * 0.5, -s * 1.3);
        ctx.stroke();
    }

    // Engine glow (back of ship)
    ctx.shadowBlur = 0;
    const engineGrad = ctx.createRadialGradient(0, s * 0.7, 0, 0, s * 0.7, s * 0.5);
    engineGrad.addColorStop(0, engineColor);
    engineGrad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = engineGrad;
    ctx.beginPath();
    ctx.ellipse(0, s * 0.7, s * 0.4, s * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();

    // Shield ring
    if (maxShields > 0 && shields > 0) {
        const shieldAlpha = (shields / maxShields) * 0.6;
        ctx.strokeStyle = `rgba(0, 180, 255, ${shieldAlpha})`;
        ctx.lineWidth = 2;
        ctx.shadowColor = '#00aaff';
        ctx.shadowBlur = 8;
        ctx.beginPath();
        ctx.arc(0, 0, s * 1.5, 0, Math.PI * 2);
        ctx.stroke();
    }

    ctx.restore();
}

export const EnemyOverlay: React.FC<EnemyOverlayProps> = ({ combatStateRef }) => {
    const { cameraRef } = useAppContext();
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        let animId: number;

        const render = () => {
            const w = window.innerWidth;
            const h = window.innerHeight;
            if (canvas.width !== w || canvas.height !== h) {
                canvas.width = w;
                canvas.height = h;
            }

            ctx.clearRect(0, 0, w, h);

            const cs = combatStateRef.current;
            const cam = cameraRef.current;
            const pitch = cam.rotation[0];
            const yaw = cam.rotation[1];
            const roll = cam.roll;

            // Sort enemies back-to-front for correct overlap
            const visibleEnemies: Array<{ enemy: Enemy; depth: number; sx: number; sy: number }> = [];

            for (const enemy of cs.enemies) {
                if (enemy.state === 'dead') continue;

                const proj = worldToScreen(
                    enemy.position[0], enemy.position[1], enemy.position[2],
                    cam.position[0], cam.position[1], cam.position[2],
                    pitch, yaw, roll, w, h
                );
                if (!proj) continue;

                visibleEnemies.push({ enemy, depth: proj.depth, sx: proj.x, sy: proj.y });
            }

            // Sort back to front
            visibleEnemies.sort((a, b) => b.depth - a.depth);

            for (const { enemy, depth, sx, sy } of visibleEnemies) {
                // Size based on distance (perspective)
                const size = Math.max(8, Math.min(60, 120 / depth));

                drawEnemyShip(
                    ctx, sx, sy, size,
                    enemy.shapeVariant,
                    enemy.hitFlashTimer,
                    enemy.deathTimer,
                    enemy.shields,
                    enemy.maxShields,
                    enemy.health,
                    enemy.maxHealth,
                    enemy.rotation[1],
                    yaw
                );
            }

            animId = requestAnimationFrame(render);
        };

        animId = requestAnimationFrame(render);
        return () => cancelAnimationFrame(animId);
    }, [combatStateRef, cameraRef]);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 pointer-events-none"
            style={{ zIndex: 11 }}
        />
    );
};
