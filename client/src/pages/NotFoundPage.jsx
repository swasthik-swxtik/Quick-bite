import { Link } from 'react-router-dom';
const NotFoundPage = () => (
  <div className="page-content" style={{display:'flex',alignItems:'center',justifyContent:'center'}}>
    <div style={{textAlign:'center'}}>
      <h1 style={{fontSize:'4rem',color:'var(--clr-primary)'}}>404</h1>
      <h2>Page Not Found</h2>
      <p style={{marginBottom:'var(--space-6)'}}>The page you're looking for doesn't exist.</p>
      <Link to="/" className="btn btn-primary">Back to Home</Link>
    </div>
  </div>
);
export default NotFoundPage;
