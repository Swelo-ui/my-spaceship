/**
 * ProjectileOverlay — renders laser projectiles as glowing lines on a Canvas 2D overlay.
 * Uses screen-space projection for performance (no WebGL needed for simple lines).
 */

import React, { useRef, useEffect, MutableRefObject } from 'react';
import { useAppContext } from '../context/AppContext';
import { CombatState } from '../types';

interface ProjectileOverlayProps {
    combatStateRef: MutableRefObject<CombatState>;
}

// Project a 3D world point to 2D screen coordinates
// Returns null if behind camera
const projectToScreen = (
    worldPos: [number, number, number],
    camPos: [number, number, number],
    camPitch: number,
    camYaw: number,
    camRoll: number,
    w: number,
    h: number,
): [number, number, number] | null => {
    // Translate to camera space
    let dx = worldPos[0] - camPos[0];
    let dy = worldPos[1] - camPos[1];
    let dz = worldPos[2] - camPos[2];

    // Apply inverse yaw (rotate around Y)
    const cosYaw = Math.cos(-camYaw), sinYaw = Math.sin(-camYaw);
    let rx = dx * cosYaw - dz * sinYaw;
    let ry = dy;
    let rz = dx * sinYaw + dz * cosYaw;

    // Apply inverse pitch (rotate around X)
    const cosPitch = Math.cos(-camPitch), sinPitch = Math.sin(-camPitch);
    const ry2 = ry * cosPitch - rz * sinPitch;
    const rz2 = ry * sinPitch + rz * cosPitch;
    ry = ry2; rz = rz2;

    // Apply inverse roll (rotate around Z)
    const cosRoll = Math.cos(-camRoll), sinRoll = Math.sin(-camRoll);
    const rx2 = rx * cosRoll - ry * sinRoll;
    const ry3 = rx * sinRoll + ry * cosRoll;
    rx = rx2; ry = ry3;

    // Behind camera
    if (rz >= 0) return null;

    // Perspective projection (FOV ~90 deg, focal length ~1.5)
    const focalLen = 1.5;
    const aspect = w / h;
    const screenX = (rx / (-rz) * focalLen) / aspect * (w / 2) + w / 2;
    const screenY = (ry / (-rz) * focalLen) * (h / 2) + h / 2;
    const depth = -rz; // positive = in front

    return [screenX, screenY, depth];
};

export const ProjectileOverlay: React.FC<ProjectileOverlayProps> = ({ combatStateRef }) => {
    const { cameraRef, isHudEnabled } = useAppContext();
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

            for (const proj of cs.projectiles) {
                // Project current and previous position (tail)
                const tailPos: [number, number, number] = [
                    proj.position[0] - proj.velocity[0] * 0.08,
                    proj.position[1] - proj.velocity[1] * 0.08,
                    proj.position[2] - proj.velocity[2] * 0.08,
                ];

                const head = projectToScreen(proj.position, cam.position, pitch, yaw, roll, w, h);
                const tail = projectToScreen(tailPos, cam.position, pitch, yaw, roll, w, h);

                if (!head || !tail) continue;

                const depth = head[2];
                // Fade with distance
                const alpha = Math.max(0, Math.min(1, 1.0 - depth / 15.0));
                const lineWidth = Math.max(1, 3 / (depth * 0.3 + 1));

                if (proj.isPlayerShot) {
                    // Player laser: bright cyan/white
                    ctx.strokeStyle = `rgba(100, 220, 255, ${alpha})`;
                    ctx.shadowColor = 'rgba(0, 200, 255, 0.8)';
                    ctx.shadowBlur = 8;
                } else {
                    // Enemy laser: red/orange
                    ctx.strokeStyle = `rgba(255, 80, 30, ${alpha})`;
                    ctx.shadowColor = 'rgba(255, 50, 0, 0.8)';
                    ctx.shadowBlur = 8;
                }

                ctx.lineWidth = lineWidth;
                ctx.beginPath();
                ctx.moveTo(tail[0], tail[1]);
                ctx.lineTo(head[0], head[1]);
                ctx.stroke();

                // Bright core
                ctx.lineWidth = lineWidth * 0.4;
                ctx.strokeStyle = proj.isPlayerShot
                    ? `rgba(255, 255, 255, ${alpha * 0.9})`
                    : `rgba(255, 200, 100, ${alpha * 0.9})`;
                ctx.shadowBlur = 0;
                ctx.beginPath();
                ctx.moveTo(tail[0], tail[1]);
                ctx.lineTo(head[0], head[1]);
                ctx.stroke();
            }

            // Reset shadow
            ctx.shadowBlur = 0;

            animId = requestAnimationFrame(render);
        };

        animId = requestAnimationFrame(render);
        return () => cancelAnimationFrame(animId);
    }, [combatStateRef, cameraRef]);

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 pointer-events-none"
            style={{ zIndex: 15 }}
        />
    );
};
