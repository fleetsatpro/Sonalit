import React from 'react';
export default class ErrorBoundary extends React.Component {
  state = { error: null };
  componentDidCatch(error) { this.setState({ error }); }
  render() {
    if (this.state.error) return (
      <div style={{color:'red',padding:'20px',fontFamily:'monospace'}}>
        <h2>App crashed:</h2>
        <pre>{this.state.error.toString()}</pre>
        <pre>{this.state.error.stack}</pre>
      </div>
    );
    return this.props.children;
  }
}
