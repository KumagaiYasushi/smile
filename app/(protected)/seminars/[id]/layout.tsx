import EventNavigation from '@/components/EventNavigation';
import {getSeminarById} from '@/lib/db';
export default async function EventLayout({children,params}:{children:React.ReactNode;params:Promise<{id:string}>}){const {id}=await params;const event=/^[1-9]\d*$/.test(id)?getSeminarById(Number(id)):null;return <>{event&&<EventNavigation id={event.id} name={event.name}/>}<div>{children}</div></>;}
