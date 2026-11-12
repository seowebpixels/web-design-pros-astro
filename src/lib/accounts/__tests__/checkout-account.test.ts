import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {accountRequest} from '../../../scripts/account-client';
vi.mock('../../../scripts/account-client',()=>({accountRequest:vi.fn()}));

const profile={firstName:'New',lastName:'Customer',phone:'0100000000',company:'Test company',address:'Sample street',city:'Test city',province:'Test province',postalCode:'0000',country:'South Africa'};
function page(){
  const elements=new Map<string,any>(),events=new Map<string,Function>();
  const element=(id:string)=>{
    if(!elements.has(id))elements.set(id,{value:'',hidden:false,disabled:false,required:true,textContent:'',addEventListener:vi.fn(),reportValidity:()=>true});
    return elements.get(id);
  };
  const form=element('checkout-form');
  form.elements={namedItem:element};form.querySelector=()=>({value:'new'});form.reportValidity=()=>true;
  vi.stubGlobal('document',{getElementById:element});
  vi.stubGlobal('window',{addEventListener:(name:string,handler:Function)=>events.set(name,handler)});
  // There is no sessionStorage in this new tab. Recovery must use the saved profile.
  return {element,events};
}
beforeEach(()=>{vi.resetModules();vi.mocked(accountRequest).mockReset();});
afterEach(()=>{vi.unstubAllGlobals();});
describe('checkout after email verification',()=>{
  it('pre-populates every billing field in a new tab and keeps later edits when the tab regains focus',async()=>{
    const screen=page();
    const fetchProfile=vi.fn().mockResolvedValue(new Response(JSON.stringify({user:{name:'New Customer',email:'new@example.com'},profile}),{status:200}));
    vi.stubGlobal('fetch',fetchProfile);
    const {loadCheckoutAccount}=await import('../../../scripts/checkout-account');
    await loadCheckoutAccount();
    for(const [key,value] of Object.entries(profile))expect(screen.element(key).value).toBe(value);
    expect(screen.element('account-credentials').hidden).toBe(true);
    expect(screen.element('billing-fields').disabled).toBe(false);
    expect(screen.element('login-status').textContent).toContain('saved billing details');
    screen.element('address').value='Updated street';screen.events.get('focus')!();
    expect(fetchProfile).toHaveBeenCalledTimes(1);expect(screen.element('address').value).toBe('Updated street');
  });
  it('submits billing details with signup before asking the customer to verify their email',async()=>{
    const screen=page();for(const [key,value] of Object.entries(profile))screen.element(key).value=value;
    screen.element('email').value='new@example.com';screen.element('password').value='Abcd1234';
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('{}',{status:401})));
    vi.mocked(accountRequest).mockResolvedValue({});
    const {ensureCheckoutAccount}=await import('../../../scripts/checkout-account');
    await expect(ensureCheckoutAccount()).rejects.toThrow('billing details are saved');
    expect(accountRequest).toHaveBeenCalledWith('/api/auth/sign-up/email',expect.objectContaining({email:'new@example.com',billingProfile:profile}));
    expect(screen.element('password').value).toBe('');
  });
});
