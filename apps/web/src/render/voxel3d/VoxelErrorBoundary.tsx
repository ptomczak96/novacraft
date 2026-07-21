import React from 'react';

interface State {
  failed: boolean;
}

/**
 * If WebGL is unavailable (or the 3D pipeline throws), show a message instead
 * of letting the error unmount the whole app — the 2D/3D toggle stays usable
 * so the player can switch back.
 */
export class VoxelErrorBoundary extends React.Component<React.PropsWithChildren, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown) {
    console.error('[voxel3d] renderer failed, falling back:', error);
  }

  render() {
    if (this.state.failed) {
      return (
        <div style={{
          position: 'absolute', inset: 0, display: 'flex',
          alignItems: 'center', justifyContent: 'center',
          color: '#8ecbff', fontFamily: 'monospace', fontSize: 13,
          background: '#12101e', textAlign: 'center', padding: 24,
        }}>
          The 3D renderer could not start (WebGL unavailable).<br />
          Use the 2D button in the top-left to switch back.
        </div>
      );
    }
    return this.props.children;
  }
}
