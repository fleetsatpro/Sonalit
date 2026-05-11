import React from 'react';
import RealLayout from './Layout.jsx.bak';

class Catch extends React.Component {
  state = { err: null };
  componentDidCatch(e) { this.setState({ err: e }); }
  render() {
    if (this.state.err) return (
      <div style={{color:'red',padding:'20px',fontFamily:'monospace',whiteSpace:'pre-wrap'}}>
        LAYOUT CRASH:{'\n'}{this.state.err.toString()}{'\n'}{this.state.err.stack}
      </div>
    );
    return this.props.children;
  }
}

export default function Layout(props) {
  return <Catch><RealLayout {...props} /></Catch>;
}
