import React, { useCallback, useEffect, useRef, useState } from 'react';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const RangeSlider = ({ min = 0, max = 100, value = 0, onChange, onChangeComplete }) => {
    const inputRef = useRef(null);
    const [internalValue, setInternalValue] = useState(value);

    useEffect(() => {
        setInternalValue(value);
    }, [value]);

    const emitChange = useCallback((nextValue) => {
        const clamped = clamp(nextValue, min, max);
        setInternalValue(clamped);
        if (onChange) {
            onChange(clamped);
        }
    }, [min, max, onChange]);

    const emitChangeComplete = useCallback(() => {
        if (onChangeComplete) {
            onChangeComplete(internalValue);
        }
    }, [internalValue, onChangeComplete]);

    const handleInput = (event) => {
        const nextValue = Number(event.target.value);
        emitChange(nextValue);
    };

    const clampedValue = clamp(internalValue, min, max);
    const progress = max === min ? 0 : (clampedValue - min) / (max - min);
    const percent = progress * 100;

    return (
        <div className="range-slider">
            <input
                ref={inputRef}
                className="range-slider__input"
                type="range"
                min={min}
                max={max}
                value={internalValue}
                onChange={handleInput}
                onMouseUp={emitChangeComplete}
                onTouchEnd={emitChangeComplete}
                onPointerUp={emitChangeComplete}
                style={{
                    '--range-percent': `${percent}%`,
                    '--range-progress': progress
                }}
            />
        </div>
    );
};

export default RangeSlider;
