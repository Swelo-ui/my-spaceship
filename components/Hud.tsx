/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/









import React, { useRef, useEffect } from 'react';
import { useAppContext } from '../context/AppContext';

// Independent high-performance 2D renderer for HUD overlay
// Bypasses React state for 60fps updates
export const Hud: React.FC = () => {
    const { cameraRef, renderCameraRef, cameraVelocityRef, isHudEnabled, collisionState, viewModeTransition } = useAppContext();
    const canvasRef = useRef<HTMLCanvasElement>(null);

    // Use refs to access latest values in render loop without re-triggering effect
    const collisionStateRef = useRef(collisionState);
    useEffect(() => {
        collisionStateRef.current = collisionState;
    }, [collisionState]);

    // PERF FIX: viewModeTransition was in useEffect deps, causing RAF restart every frame during transition
    const viewModeTransitionRef = useRef(viewModeTransition);
    useEffect(() => {
        viewModeTransitionRef.current = viewModeTransition;
    }, [viewModeTransition]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas || !isHudEnabled) return;

        const ctx = canvas.getContext('2d', { alpha: true });
        if (!ctx) return;

        // Set font once — not every frame
        ctx.font = 'bold 12px monospace';

        let animationFrameId: number;

        const render = () => {
            // Handle resize
            if (canvas.width !== window.innerWidth || canvas.height !== window.innerHeight) {
                canvas.width = window.innerWidth;
                canvas.height = window.innerHeight;
                // Re-set font after canvas resize (resize clears canvas state)
                ctx.font = 'bold 12px monospace';
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const w = canvas.width;
            const h = canvas.height;
            const cx = w / 2;
            const cy = h / 2;

            // Read from ref — no React re-render dependency
            const hudAlpha = 1.0 - viewModeTransitionRef.current;

            // Read mutable refs directly for max speed
            const cam = renderCameraRef.current; // Use renderCamera for correct perspective
            const pitch = cam.rotation[0];
            const yaw = cam.rotation[1];
            const altitude = cameraRef.current.position[1] + 1.49; // Offset by 1.49 so 0 is roughly "ground" level
            const vY = cameraVelocityRef.current[1];

            // --- STYLES & COLORS based on Collision State ---
            const currentState = collisionStateRef.current;
            let baseColorStr = '0, 255, 255'; // Cyan (Default)
            if (currentState === 'approaching') {
                baseColorStr = '255, 200, 0'; // Yellow Warning
            } else if (currentState === 'colliding') {
                baseColorStr = '255, 50, 50'; // Red Alert
            }

            if (hudAlpha > 0.01) {
                ctx.strokeStyle = `rgba(${baseColorStr}, ${0.5 * hudAlpha})`;
                ctx.fillStyle = `rgba(${baseColorStr}, ${0.8 * hudAlpha})`;
                ctx.lineWidth = 2;

                // --- HORIZON LINE ---
                const fovY = Math.PI / 2; // Assume 90 deg FOV
                const horizonOffsetY = -(pitch / (fovY / 2)) * (h / 2);
                const horizonY = cy + horizonOffsetY;

                if (horizonY > -100 && horizonY < h + 100) {
                    ctx.beginPath();
                    const gap = 100;
                    ctx.moveTo(cx - 300, horizonY); ctx.lineTo(cx - gap, horizonY);
                    ctx.moveTo(cx + gap, horizonY); ctx.lineTo(cx + 300, horizonY);
                    ctx.stroke();
                }

                // --- CENTER CROSSHAIR (Waterline) ---
                ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 * hudAlpha})`;
                ctx.beginPath();
                ctx.moveTo(cx - 20, cy); ctx.lineTo(cx - 5, cy);
                ctx.moveTo(cx + 5, cy); ctx.lineTo(cx + 20, cy);
                ctx.moveTo(cx, cy - 15); ctx.lineTo(cx, cy - 5);
                ctx.stroke();
                ctx.fillStyle = `rgba(255,255,255,${0.5 * hudAlpha})`;
                ctx.fillRect(cx - 1, cy - 1, 2, 2);


                // --- READOUTS ---
                const altText = `ALT: ${altitude.toFixed(2)}`;
                const vsText = `V/S: ${(vY * 10).toFixed(2)}`;

                ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * hudAlpha})`;
                ctx.fillRect(cx + 345, cy - 52, 80, 18);
                ctx.fillRect(cx + 345, cy - 32, 80, 18);

                ctx.fillStyle = `rgba(${baseColorStr}, ${0.8 * hudAlpha})`;
                ctx.textAlign = 'left';
                ctx.fillText(altText, cx + 350, cy - 40);
                ctx.fillText(vsText, cx + 350, cy - 20);

                // Heading
                const headingDeg = (((-yaw * 180 / Math.PI) % 360) + 360) % 360;
                const headingText = `${headingDeg.toFixed(0)}°`;
                ctx.fillStyle = `rgba(0, 0, 0, ${0.5 * hudAlpha})`;
                ctx.fillRect(cx - 20, 48, 40, 18);

                ctx.fillStyle = `rgba(${baseColorStr}, ${0.8 * hudAlpha})`;
                ctx.textAlign = 'center';
                ctx.fillText(headingText, cx, 60);

                // --- CLIMB RATE INDICATOR ---
                const crHeight = 100;
                const crY = cy;
                const crX = cx + 330;
                ctx.strokeStyle = `rgba(${baseColorStr}, ${0.3 * hudAlpha})`;
                ctx.fillStyle = `rgba(0, 0, 0, ${0.3 * hudAlpha})`;
                ctx.fillRect(crX - 3, crY - crHeight / 2, 6, crHeight);
                ctx.strokeRect(crX - 3, crY - crHeight / 2, 6, crHeight);

                const vYClamped = Math.max(-0.5, Math.min(0.5, vY));
                const indicatorY = crY - (vYClamped / 0.5) * (crHeight / 2);

                ctx.fillStyle = `rgba(${baseColorStr}, ${0.8 * hudAlpha})`;
                ctx.fillRect(crX - 3, indicatorY - 2, 6, 4);
            }

            animationFrameId = requestAnimationFrame(render);
        };

        render();

        return () => {
            cancelAnimationFrame(animationFrameId);
        };
    }, [isHudEnabled, cameraRef, renderCameraRef, cameraVelocityRef]);

    if (!isHudEnabled) return null;

    return (
        <canvas
            ref={canvasRef}
            className="fixed inset-0 z-20 pointer-events-none"
        />
    );
};