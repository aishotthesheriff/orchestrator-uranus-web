import CheckDisplay from '../CheckDisplay';

export default function CheckDisplayExample() {
  return (
    <div className="space-y-4 p-6 bg-background">
      <CheckDisplay 
        skill="Bureaucracy" 
        dc={12} 
        roll={15} 
        success={true}
        description="The form was accepted after only 3 revisions!"
      />
      <CheckDisplay 
        skill="Engineering" 
        dc={18} 
        roll={9} 
        success={false}
        description="The duct tape melted. Who knew space was hot?"
      />
    </div>
  );
}
